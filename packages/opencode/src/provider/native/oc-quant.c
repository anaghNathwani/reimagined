/*
 * oc-quant.c — hyper-fast, streaming GGUF model quantizer
 *
 * Two execution modes:
 *
 *   STREAM mode  (Q4_0, Q8_0, Q4_0_FAST):
 *     - Parses the GGUF file directly without loading a model.
 *     - Memory-maps the input; processes tensors in parallel across N threads.
 *     - Calls madvise(MADV_DONTNEED) after each tensor — peak RAM = O(tensor).
 *     - Uses ARM NEON / x86 SSE2 SIMD for quantization kernels.
 *
 *   LLAMA mode  (Q4_K_M, Q5_K_M, Q3_K_M, Q2_K, Q6_K):
 *     - Delegates to llama_model_quantize() for importance-matrix-aware K-quants.
 *     - Kept because K-quant scale selection requires the full model context.
 *
 * Usage:
 *   oc-quant [--threads N] [--pure] <input.gguf> <output.gguf> [QUANT_TYPE]
 *
 *   QUANT_TYPE: Q4_0 (fast/stream)  Q8_0 (fast/stream)
 *               Q4_K_M (default, quality)  Q5_K_M  Q3_K_M  Q2_K  Q6_K
 *   --threads N   threads (default: all CPUs for Q4_0/Q8_0, nCPU-1 for K-quants)
 *   --pure        quantize every tensor including embeddings/output
 *
 * Exit codes: 0 = success, 1 = error
 */

/* ── Portability ────────────────────────────────────────────────────────────── */

#if defined(_WIN32)
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#  include <io.h>
#  define unlink _unlink
   static void *mmap_file(HANDLE *out_fh, HANDLE *out_mh, const char *path, size_t *out_size);
   static void  munmap_file(void *p, size_t sz, HANDLE fh, HANDLE mh);
#else
#  include <unistd.h>
#  include <sys/mman.h>
#  include <pthread.h>
#  include <fcntl.h>
#endif

#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include <sys/stat.h>

/* SIMD */
#if defined(__ARM_NEON)
#  include <arm_neon.h>
#  define HAVE_NEON 1
#elif defined(__SSE2__)
#  include <emmintrin.h>
#  define HAVE_SSE2 1
#endif

/* ── GGUF constants ──────────────────────────────────────────────────────────── */

#define GGUF_MAGIC   0x46554747u   /* "GGUF" LE */
#define GGUF_ALIGN   32

enum {
    GGUF_TYPE_UINT8   = 0,  GGUF_TYPE_INT8   = 1,
    GGUF_TYPE_UINT16  = 2,  GGUF_TYPE_INT16  = 3,
    GGUF_TYPE_UINT32  = 4,  GGUF_TYPE_INT32  = 5,
    GGUF_TYPE_FLOAT32 = 6,  GGUF_TYPE_BOOL   = 7,
    GGUF_TYPE_STRING  = 8,  GGUF_TYPE_ARRAY  = 9,
    GGUF_TYPE_UINT64  = 10, GGUF_TYPE_INT64  = 11,
    GGUF_TYPE_FLOAT64 = 12,
};

enum ggml_type_e {
    GGML_TYPE_F32  = 0,
    GGML_TYPE_F16  = 1,
    GGML_TYPE_Q4_0 = 2,
    GGML_TYPE_Q8_0 = 8,
    GGML_TYPE_BF16 = 30,
};

/* ── Block structures ────────────────────────────────────────────────────────── */

#define QK4_0 32
typedef struct { uint16_t d; uint8_t qs[QK4_0/2]; } block_q4_0;  /* 18 bytes */

#define QK8_0 32
typedef struct { uint16_t d; int8_t  qs[QK8_0];   } block_q8_0;  /* 34 bytes */

/* ── FP16 <-> FP32 ───────────────────────────────────────────────────────────── */

static inline uint16_t fp32_to_fp16(float f) {
    uint32_t x; memcpy(&x, &f, 4);
    uint32_t sign = (x >> 16) & 0x8000u;
    int      exp  = ((int)(x >> 23) & 0xFF) - 127 + 15;
    uint32_t mant = x & 0x7FFFFFu;
    if (exp <= 0)  return (uint16_t)sign;
    if (exp >= 31) return (uint16_t)(sign | 0x7C00u);
    return (uint16_t)(sign | ((uint32_t)exp << 10) | (mant >> 13));
}

static inline float fp16_to_fp32(uint16_t h) {
    uint32_t sign = (uint32_t)(h & 0x8000u) << 16;
    uint32_t exp  = (h >> 10) & 0x1Fu;
    uint32_t mant = h & 0x3FFu;
    uint32_t x;
    if (exp == 0)       x = sign | (mant << 13);
    else if (exp == 31) x = sign | 0x7F800000u | (mant << 13);
    else                x = sign | ((exp + 112u) << 23) | (mant << 13);
    float f; memcpy(&f, &x, 4); return f;
}

static inline float bf16_to_fp32(uint16_t b) {
    uint32_t x = (uint32_t)b << 16;
    float f; memcpy(&f, &x, 4); return f;
}

/* ── GGUF reader ─────────────────────────────────────────────────────────────── */

typedef struct {
    char     name[256];
    uint32_t n_dims;
    uint64_t dims[4];
    uint32_t type;      /* ggml_type */
    uint64_t offset;    /* from data section start */
    uint64_t n_elems;
    uint64_t nbytes;    /* raw byte count in source */
} tensor_info;

typedef struct {
    const uint8_t *data;   /* mmap base */
    size_t         size;
    uint32_t       version;
    uint64_t       n_tensors;
    uint64_t       n_kv;
    const uint8_t *kv_start;   /* pointer into mmap */
    size_t         kv_bytes;   /* byte size of entire KV section */
    const uint8_t *data_start; /* tensor data section base */
    uint64_t       alignment;
    tensor_info   *tensors;
} gguf_ctx;

/* Byte sizes of fixed-width scalar GGUF types */
static size_t gguf_scalar_size(uint32_t t) {
    switch (t) {
    case GGUF_TYPE_UINT8: case GGUF_TYPE_INT8: case GGUF_TYPE_BOOL: return 1;
    case GGUF_TYPE_UINT16: case GGUF_TYPE_INT16: return 2;
    case GGUF_TYPE_UINT32: case GGUF_TYPE_INT32: case GGUF_TYPE_FLOAT32: return 4;
    case GGUF_TYPE_UINT64: case GGUF_TYPE_INT64: case GGUF_TYPE_FLOAT64: return 8;
    default: return 0;
    }
}

/* Skip past one GGUF value of the given type. Returns new cursor or NULL on error. */
static const uint8_t *skip_value(const uint8_t *p, const uint8_t *end, uint32_t t) {
    if (t == GGUF_TYPE_STRING) {
        if (p + 8 > end) return NULL;
        uint64_t len; memcpy(&len, p, 8); p += 8 + len;
        return (p <= end) ? p : NULL;
    }
    if (t == GGUF_TYPE_ARRAY) {
        if (p + 12 > end) return NULL;
        uint32_t arr_t; memcpy(&arr_t, p, 4); p += 4;
        uint64_t arr_n; memcpy(&arr_n, p, 8); p += 8;
        for (uint64_t i = 0; i < arr_n; i++) {
            p = skip_value(p, end, arr_t);
            if (!p) return NULL;
        }
        return p;
    }
    size_t sz = gguf_scalar_size(t);
    if (!sz || p + sz > end) return NULL;
    return p + sz;
}

/* Read a length-prefixed GGUF string. Returns new cursor or NULL. */
static const uint8_t *read_str(const uint8_t *p, const uint8_t *end,
                                char *out, size_t out_cap) {
    if (p + 8 > end) return NULL;
    uint64_t len; memcpy(&len, p, 8); p += 8;
    if (p + len > end) return NULL;
    size_t cp = (len < out_cap - 1) ? (size_t)len : out_cap - 1;
    memcpy(out, p, cp);
    out[cp] = '\0';
    return p + len;
}

static size_t ggml_type_nbytes_row(uint32_t t, uint64_t ne) {
    switch (t) {
    case GGML_TYPE_F32:  return ne * 4;
    case GGML_TYPE_F16:  return ne * 2;
    case GGML_TYPE_BF16: return ne * 2;
    case GGML_TYPE_Q4_0: return (ne / QK4_0) * sizeof(block_q4_0);
    case GGML_TYPE_Q8_0: return (ne / QK8_0) * sizeof(block_q8_0);
    default:             return 0;  /* unknown / unsupported */
    }
}

static int gguf_parse(gguf_ctx *ctx) {
    const uint8_t *p   = ctx->data;
    const uint8_t *end = ctx->data + ctx->size;

    /* magic */
    if (p + 4 > end) return -1;
    uint32_t magic; memcpy(&magic, p, 4); p += 4;
    if (magic != GGUF_MAGIC) { fprintf(stderr, "Not a GGUF file\n"); return -1; }

    /* version */
    if (p + 4 > end) return -1;
    memcpy(&ctx->version, p, 4); p += 4;
    if (ctx->version < 2 || ctx->version > 3) {
        fprintf(stderr, "GGUF version %u unsupported\n", ctx->version);
        return -1;
    }

    /* counts */
    if (p + 16 > end) return -1;
    memcpy(&ctx->n_tensors, p, 8); p += 8;
    memcpy(&ctx->n_kv,      p, 8); p += 8;

    /* KV pairs — copy section, scan for alignment key */
    ctx->kv_start = p;
    ctx->alignment = GGUF_ALIGN;

    for (uint64_t i = 0; i < ctx->n_kv; i++) {
        char key[256];
        p = read_str(p, end, key, sizeof(key));
        if (!p || p + 4 > end) return -1;
        uint32_t vtype; memcpy(&vtype, p, 4); p += 4;

        if (strcmp(key, "general.alignment") == 0 && vtype == GGUF_TYPE_UINT32) {
            if (p + 4 > end) return -1;
            memcpy(&ctx->alignment, p, 4);
        }
        p = skip_value(p, end, vtype);
        if (!p) return -1;
    }
    ctx->kv_bytes = (size_t)(p - ctx->kv_start);

    /* Tensor infos */
    ctx->tensors = (tensor_info *)calloc(ctx->n_tensors, sizeof(tensor_info));
    if (!ctx->tensors) return -1;

    for (uint64_t i = 0; i < ctx->n_tensors; i++) {
        tensor_info *t = &ctx->tensors[i];

        p = read_str(p, end, t->name, sizeof(t->name));
        if (!p || p + 4 > end) return -1;
        memcpy(&t->n_dims, p, 4); p += 4;

        if (t->n_dims > 4 || p + t->n_dims * 8 > end) return -1;
        t->n_elems = 1;
        for (uint32_t d = 0; d < t->n_dims; d++) {
            memcpy(&t->dims[d], p, 8); p += 8;
            t->n_elems *= t->dims[d];
        }

        if (p + 12 > end) return -1;
        memcpy(&t->type,   p, 4); p += 4;
        memcpy(&t->offset, p, 8); p += 8;
        t->nbytes = ggml_type_nbytes_row(t->type, t->n_elems);
    }

    /* Data section starts at next aligned offset */
    uint64_t cursor = (uint64_t)(p - ctx->data);
    uint64_t align  = ctx->alignment;
    uint64_t pad    = (align - (cursor % align)) % align;
    ctx->data_start = ctx->data + cursor + pad;

    return 0;
}

/* ── Time ────────────────────────────────────────────────────────────────────── */

static double now_sec(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + ts.tv_nsec * 1e-9;
}

/* ── Formatting ──────────────────────────────────────────────────────────────── */

static void fmt_size(long long bytes, char *buf, int cap) {
    if (bytes < 0)                    { snprintf(buf,cap,"?"); return; }
    if (bytes < 1LL<<20)              snprintf(buf,cap,"%.1f KB", bytes/1024.0);
    else if (bytes < 1LL<<30)         snprintf(buf,cap,"%.2f MB", bytes/1048576.0);
    else                              snprintf(buf,cap,"%.2f GB", bytes/1073741824.0);
}

/* ── SIMD quantization kernels ───────────────────────────────────────────────── */

/* Q4_0: groups of 32 floats → 18-byte block.
   Scale = max_abs / 7.  Two 4-bit values packed per byte.
   Interleaving: qs[j] = low16[j] | (high16[j] << 4)  (ggml convention). */

static void quantize_q4_0_scalar(const float *src, block_q4_0 *dst, int nb) {
    for (int b = 0; b < nb; b++) {
        const float *x = src + b * QK4_0;
        float amax = 0.f;
        for (int i = 0; i < QK4_0; i++) { float v = fabsf(x[i]); if (v > amax) amax = v; }
        float d  = amax / 7.f;
        dst[b].d = fp32_to_fp16(d);
        float id = d ? 1.f / d : 0.f;
        for (int j = 0; j < QK4_0/2; j++) {
            uint8_t x0 = (uint8_t)((int)(x[j]          * id + 8.5f) & 0xF);
            uint8_t x1 = (uint8_t)((int)(x[j + QK4_0/2]* id + 8.5f) & 0xF);
            dst[b].qs[j] = x0 | (x1 << 4);
        }
    }
}

#if defined(HAVE_NEON)
static void quantize_q4_0_neon(const float *src, block_q4_0 *dst, int nb) {
    for (int b = 0; b < nb; b++) {
        const float *x = src + b * QK4_0;

        /* Load 32 floats in 8 groups of 4 */
        float32x4_t v[8];
        for (int i = 0; i < 8; i++) v[i] = vld1q_f32(x + i*4);

        /* Find max abs across all 32 */
        float32x4_t ma = vabsq_f32(v[0]);
        for (int i = 1; i < 8; i++) ma = vmaxq_f32(ma, vabsq_f32(v[i]));
        float amax = vmaxvq_f32(ma);

        float d  = amax / 7.f;
        dst[b].d = fp32_to_fp16(d);
        float32x4_t vid = vdupq_n_f32(d ? 1.f/d : 0.f);
        float32x4_t v85 = vdupq_n_f32(8.5f);
        float32x4_t v15 = vdupq_n_f32(15.f);
        float32x4_t v00 = vdupq_n_f32(0.f);

        /* Quantize first 16 (low nibbles) */
        uint8_t lo[16], hi[16];
        for (int g = 0; g < 4; g++) {
            float32x4_t q = vminq_f32(vmaxq_f32(vaddq_f32(vmulq_f32(v[g],   vid), v85), v00), v15);
            int32x4_t   qi = vcvtq_s32_f32(q);
            lo[g*4+0] = (uint8_t)vgetq_lane_s32(qi,0);
            lo[g*4+1] = (uint8_t)vgetq_lane_s32(qi,1);
            lo[g*4+2] = (uint8_t)vgetq_lane_s32(qi,2);
            lo[g*4+3] = (uint8_t)vgetq_lane_s32(qi,3);
        }
        /* Quantize second 16 (high nibbles) */
        for (int g = 0; g < 4; g++) {
            float32x4_t q = vminq_f32(vmaxq_f32(vaddq_f32(vmulq_f32(v[g+4], vid), v85), v00), v15);
            int32x4_t   qi = vcvtq_s32_f32(q);
            hi[g*4+0] = (uint8_t)vgetq_lane_s32(qi,0);
            hi[g*4+1] = (uint8_t)vgetq_lane_s32(qi,1);
            hi[g*4+2] = (uint8_t)vgetq_lane_s32(qi,2);
            hi[g*4+3] = (uint8_t)vgetq_lane_s32(qi,3);
        }
        for (int j = 0; j < 16; j++) dst[b].qs[j] = lo[j] | (hi[j] << 4);
    }
}
#elif defined(HAVE_SSE2)
static void quantize_q4_0_sse2(const float *src, block_q4_0 *dst, int nb) {
    for (int b = 0; b < nb; b++) {
        const float *x = src + b * QK4_0;
        __m128 v[8];
        for (int i = 0; i < 8; i++) v[i] = _mm_loadu_ps(x + i*4);

        /* abs mask */
        __m128i amask = _mm_set1_epi32(0x7FFFFFFF);
        __m128 ma = _mm_and_ps(v[0], (__m128)amask);
        for (int i = 1; i < 8; i++) ma = _mm_max_ps(ma, _mm_and_ps(v[i], (__m128)amask));

        /* horizontal max of 4 lanes */
        __m128 t = _mm_max_ps(ma, _mm_shuffle_ps(ma, ma, 0xB1));
        t = _mm_max_ps(t, _mm_shuffle_ps(t, t, 0x4E));
        float amax; _mm_store_ss(&amax, t);

        float d  = amax / 7.f;
        dst[b].d = fp32_to_fp16(d);
        __m128 vid = _mm_set1_ps(d ? 1.f/d : 0.f);
        __m128 v85 = _mm_set1_ps(8.5f);
        __m128 v15 = _mm_set1_ps(15.f);
        __m128 v00 = _mm_setzero_ps();

        uint8_t lo[16], hi[16];
        for (int g = 0; g < 4; g++) {
            __m128 q = _mm_min_ps(_mm_max_ps(_mm_add_ps(_mm_mul_ps(v[g],   vid), v85), v00), v15);
            __m128i qi = _mm_cvttps_epi32(q);
            lo[g*4+0] = (uint8_t)_mm_cvtsi128_si32(qi);
            lo[g*4+1] = (uint8_t)_mm_cvtsi128_si32(_mm_shuffle_epi32(qi,1));
            lo[g*4+2] = (uint8_t)_mm_cvtsi128_si32(_mm_shuffle_epi32(qi,2));
            lo[g*4+3] = (uint8_t)_mm_cvtsi128_si32(_mm_shuffle_epi32(qi,3));
        }
        for (int g = 0; g < 4; g++) {
            __m128 q = _mm_min_ps(_mm_max_ps(_mm_add_ps(_mm_mul_ps(v[g+4], vid), v85), v00), v15);
            __m128i qi = _mm_cvttps_epi32(q);
            hi[g*4+0] = (uint8_t)_mm_cvtsi128_si32(qi);
            hi[g*4+1] = (uint8_t)_mm_cvtsi128_si32(_mm_shuffle_epi32(qi,1));
            hi[g*4+2] = (uint8_t)_mm_cvtsi128_si32(_mm_shuffle_epi32(qi,2));
            hi[g*4+3] = (uint8_t)_mm_cvtsi128_si32(_mm_shuffle_epi32(qi,3));
        }
        for (int j = 0; j < 16; j++) dst[b].qs[j] = lo[j] | (hi[j] << 4);
    }
}
#endif

/* Q8_0: groups of 32 floats → 34-byte block. */
static void quantize_q8_0_scalar(const float *src, block_q8_0 *dst, int nb) {
    for (int b = 0; b < nb; b++) {
        const float *x = src + b * QK8_0;
        float amax = 0.f;
        for (int i = 0; i < QK8_0; i++) { float v = fabsf(x[i]); if (v > amax) amax = v; }
        float d  = amax / 127.f;
        dst[b].d = fp32_to_fp16(d);
        float id = d ? 1.f/d : 0.f;
        for (int i = 0; i < QK8_0; i++)
            dst[b].qs[i] = (int8_t)((int)(x[i] * id + (x[i]>=0?0.5f:-0.5f)));
    }
}

/* Dispatch table */
static void (*quant_q4_0)(const float*, block_q4_0*, int) = quantize_q4_0_scalar;
static void (*quant_q8_0)(const float*, block_q8_0*, int) = quantize_q8_0_scalar;

static void select_simd_kernels(void) {
#if defined(HAVE_NEON)
    quant_q4_0 = quantize_q4_0_neon;
#elif defined(HAVE_SSE2)
    quant_q4_0 = quantize_q4_0_sse2;
#endif
    (void)quant_q8_0; /* scalar is fast enough; Q8_0 is memory-bandwidth bound */
}

/* ── Dequant helpers: any source type → F32 scratch ─────────────────────────── */

static void deq_to_f32(const uint8_t *src, uint32_t type, float *dst, uint64_t n) {
    if (type == GGML_TYPE_F32) {
        memcpy(dst, src, n * 4);
    } else if (type == GGML_TYPE_F16) {
        const uint16_t *s = (const uint16_t *)src;
        for (uint64_t i = 0; i < n; i++) dst[i] = fp16_to_fp32(s[i]);
    } else if (type == GGML_TYPE_BF16) {
        const uint16_t *s = (const uint16_t *)src;
        for (uint64_t i = 0; i < n; i++) dst[i] = bf16_to_fp32(s[i]);
    } else {
        memset(dst, 0, n * 4);  /* unsupported — zero (caller will copy raw instead) */
    }
}

/* ── Thread pool ─────────────────────────────────────────────────────────────── */

typedef struct work_item work_item;
struct work_item {
    uint64_t     tensor_idx;
    work_item   *next;
};

typedef struct {
    pthread_mutex_t  mu;
    pthread_cond_t   cond_work;
    pthread_cond_t   cond_done;
    work_item       *head;
    int              n_pending;
    int              shutdown;
    /* set by caller before submitting jobs */
    gguf_ctx        *ctx;
    int              out_fd;
    uint64_t        *out_offsets;  /* pre-computed offsets for each tensor in output */
    uint32_t         out_type;
    bool             pure;
    /* progress */
    volatile int     done_count;
    int              total;
    double           start;
} thread_pool;

static thread_pool *g_pool;

static bool tensor_should_quantize(const tensor_info *t, bool pure) {
    if (t->type != GGML_TYPE_F32 && t->type != GGML_TYPE_F16 && t->type != GGML_TYPE_BF16)
        return false;  /* already quantized or unknown */
    if (!pure) {
        /* Keep 1-D tensors (norms, biases) and very small tensors at F16 */
        if (t->n_dims < 2 || t->n_elems < QK4_0 * 4)
            return false;
        /* Keep known output / token embedding tensors at higher precision */
        if (strstr(t->name, "output.weight")       != NULL) return false;
        if (strstr(t->name, "token_embd.weight")   != NULL) return false;
        if (strstr(t->name, "output_norm.weight")  != NULL) return false;
    }
    return true;
}

static void process_tensor(thread_pool *pool, uint64_t idx) {
    gguf_ctx    *ctx   = pool->ctx;
    tensor_info *t     = &ctx->tensors[idx];
    int          fd    = pool->out_fd;
    uint64_t     off   = pool->out_offsets[idx];
    uint32_t     otype = pool->out_type;

    const uint8_t *src_data = ctx->data_start + t->offset;

    if (!tensor_should_quantize(t, pool->pure)) {
        /* Copy raw — convert to F16 to normalise BF16 tensors */
        if (t->type == GGML_TYPE_BF16) {
            size_t n = t->n_elems;
            uint16_t *buf = (uint16_t *)malloc(n * 2);
            if (buf) {
                const uint16_t *s = (const uint16_t *)src_data;
                for (size_t i = 0; i < n; i++) {
                    float f = bf16_to_fp32(s[i]);
                    buf[i]  = fp32_to_fp16(f);
                }
                pwrite(fd, buf, n * 2, (off_t)off);
                free(buf);
            }
        } else {
            pwrite(fd, src_data, (size_t)t->nbytes, (off_t)off);
        }
#ifndef _WIN32
        madvise((void *)src_data, (size_t)t->nbytes, MADV_DONTNEED);
#endif
        return;
    }

    /* Dequantize to F32 scratch */
    float *fbuf = (float *)malloc(t->n_elems * 4);
    if (!fbuf) return;
    deq_to_f32(src_data, t->type, fbuf, t->n_elems);

#ifndef _WIN32
    /* Release input pages now — we have the data in fbuf */
    madvise((void *)src_data, (size_t)t->nbytes, MADV_DONTNEED);
#endif

    uint64_t n_blocks = t->n_elems / QK4_0;

    if (otype == GGML_TYPE_Q4_0) {
        block_q4_0 *qbuf = (block_q4_0 *)malloc(n_blocks * sizeof(block_q4_0));
        if (qbuf) {
            quant_q4_0(fbuf, qbuf, (int)n_blocks);
            pwrite(fd, qbuf, n_blocks * sizeof(block_q4_0), (off_t)off);
            free(qbuf);
        }
    } else if (otype == GGML_TYPE_Q8_0) {
        n_blocks = t->n_elems / QK8_0;
        block_q8_0 *qbuf = (block_q8_0 *)malloc(n_blocks * sizeof(block_q8_0));
        if (qbuf) {
            quant_q8_0(fbuf, qbuf, (int)n_blocks);
            pwrite(fd, qbuf, n_blocks * sizeof(block_q8_0), (off_t)off);
            free(qbuf);
        }
    }

    free(fbuf);
}

static void *worker_fn(void *arg) {
    thread_pool *pool = (thread_pool *)arg;
    while (1) {
        pthread_mutex_lock(&pool->mu);
        while (!pool->head && !pool->shutdown)
            pthread_cond_wait(&pool->cond_work, &pool->mu);
        if (pool->shutdown && !pool->head) {
            pthread_mutex_unlock(&pool->mu);
            return NULL;
        }
        work_item *item = pool->head;
        pool->head = item->next;
        pthread_mutex_unlock(&pool->mu);

        process_tensor(pool, item->tensor_idx);
        free(item);

        pthread_mutex_lock(&pool->mu);
        pool->done_count++;
        int dc = pool->done_count;
        int tot = pool->total;
        double elapsed = now_sec() - pool->start;
        pthread_mutex_unlock(&pool->mu);

        /* Progress — one line, overwritten each tick */
        int pct = (tot > 0) ? (dc * 100 / tot) : 100;
        int filled = pct / 4;
        char bar[26]; for (int i=0;i<25;i++) bar[i]=(i<filled?'#':'.'); bar[25]=0;
        double eta = (pct > 0 && pct < 100) ? elapsed*(100.0-pct)/pct : 0.0;
        if (pct < 100)
            fprintf(stderr,"\r  [%s] %3d%%  %d/%d tensors  %.0fs  ETA %.0fs   ",
                    bar,pct,dc,tot,elapsed,eta);
        else
            fprintf(stderr,"\r  [%s] 100%%  %d tensors  %.0fs            \n",
                    bar,tot,elapsed);
        fflush(stderr);

        pthread_mutex_lock(&pool->mu);
        pool->n_pending--;
        if (pool->n_pending == 0) pthread_cond_signal(&pool->cond_done);
        pthread_mutex_unlock(&pool->mu);
    }
}

/* ── Streaming quantizer (Mode 1) ────────────────────────────────────────────── */

static size_t out_tensor_nbytes(const tensor_info *t, uint32_t otype, bool pure) {
    if (!tensor_should_quantize(t, pure)) {
        /* Output as F16 (BF16 gets converted, F16/F32 stored as F16) */
        return t->n_elems * 2;
    }
    if (otype == GGML_TYPE_Q4_0) return (t->n_elems / QK4_0) * sizeof(block_q4_0);
    if (otype == GGML_TYPE_Q8_0) return (t->n_elems / QK8_0) * sizeof(block_q8_0);
    return t->n_elems * 2;
}

static uint32_t out_tensor_type(const tensor_info *t, uint32_t otype, bool pure) {
    if (!tensor_should_quantize(t, pure)) return GGML_TYPE_F16;
    return otype;
}

static int stream_quantize(const char *inp_path, const char *out_path,
                            uint32_t otype, int nthreads, bool pure) {
    /* ── mmap input ── */
    struct stat st;
    if (stat(inp_path, &st) != 0) { perror(inp_path); return 1; }
    size_t inp_size = (size_t)st.st_size;

    int inp_fd = open(inp_path, O_RDONLY);
    if (inp_fd < 0) { perror(inp_path); return 1; }

    void *inp_map = mmap(NULL, inp_size, PROT_READ, MAP_PRIVATE, inp_fd, 0);
    if (inp_map == MAP_FAILED) { perror("mmap"); close(inp_fd); return 1; }

#if defined(MADV_SEQUENTIAL)
    madvise(inp_map, inp_size, MADV_SEQUENTIAL);
#endif

    gguf_ctx ctx = { .data = (const uint8_t *)inp_map, .size = inp_size };
    if (gguf_parse(&ctx) != 0) {
        munmap(inp_map, inp_size); close(inp_fd); return 1;
    }

    /* ── Compute output layout ── */
    uint64_t *out_offsets = (uint64_t *)calloc(ctx.n_tensors, sizeof(uint64_t));
    if (!out_offsets) { munmap(inp_map,inp_size); close(inp_fd); return 1; }

    uint64_t data_cursor = 0;
    for (uint64_t i = 0; i < ctx.n_tensors; i++) {
        /* Align each tensor to ctx.alignment */
        uint64_t pad = (ctx.alignment - (data_cursor % ctx.alignment)) % ctx.alignment;
        data_cursor += pad;
        out_offsets[i] = data_cursor;
        data_cursor += out_tensor_nbytes(&ctx.tensors[i], otype, pure);
    }
    uint64_t total_data_bytes = data_cursor;

    /* ── Write output header section ── */
    char tmp_path[4096];
    snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", out_path);

    int out_fd = open(tmp_path, O_RDWR | O_CREAT | O_TRUNC, 0644);
    if (out_fd < 0) { perror(tmp_path); free(out_offsets); munmap(inp_map,inp_size); close(inp_fd); return 1; }

    /* Compute header byte size:
       magic(4) + version(4) + n_tensors(8) + n_kv(8) + kv_bytes + tensor_infos */
    size_t hdr_fixed = 4 + 4 + 8 + 8;

    /* Tensor info bytes: for each tensor: name(8+len) + n_dims(4) + dims(8*n_dims) + type(4) + offset(8) */
    size_t tinfo_bytes = 0;
    for (uint64_t i = 0; i < ctx.n_tensors; i++) {
        tensor_info *t = &ctx.tensors[i];
        tinfo_bytes += 8 + strlen(t->name) + 4 + t->n_dims*8 + 4 + 8;
    }

    size_t meta_size = hdr_fixed + ctx.kv_bytes + tinfo_bytes;
    uint64_t data_pad = (ctx.alignment - (meta_size % ctx.alignment)) % ctx.alignment;
    size_t header_total = meta_size + data_pad;
    size_t file_size = header_total + (size_t)total_data_bytes;

    /* Pre-allocate output file */
    if (ftruncate(out_fd, (off_t)file_size) != 0) { perror("ftruncate"); goto fail; }

    {
        /* Build header in a heap buffer */
        uint8_t *hbuf = (uint8_t *)calloc(1, header_total);
        if (!hbuf) goto fail;
        uint8_t *p = hbuf;

        uint32_t magic   = GGUF_MAGIC;
        uint32_t version = ctx.version;
        memcpy(p, &magic,         4); p += 4;
        memcpy(p, &version,       4); p += 4;
        memcpy(p, &ctx.n_tensors, 8); p += 8;
        memcpy(p, &ctx.n_kv,      8); p += 8;

        /* KV section: verbatim copy */
        memcpy(p, ctx.kv_start, ctx.kv_bytes); p += ctx.kv_bytes;

        /* Tensor infos (updated type + offset) */
        for (uint64_t i = 0; i < ctx.n_tensors; i++) {
            tensor_info *t = &ctx.tensors[i];
            uint64_t nlen = strlen(t->name);
            memcpy(p, &nlen,       8); p += 8;
            memcpy(p, t->name,  nlen); p += nlen;
            memcpy(p, &t->n_dims,  4); p += 4;
            for (uint32_t d = 0; d < t->n_dims; d++) { memcpy(p, &t->dims[d], 8); p += 8; }
            uint32_t wtype  = out_tensor_type(t, otype, pure);
            uint64_t woff   = out_offsets[i];
            memcpy(p, &wtype, 4); p += 4;
            memcpy(p, &woff,  8); p += 8;
        }
        /* hbuf remainder is already zeroed (padding) */

        if (pwrite(out_fd, hbuf, header_total, 0) != (ssize_t)header_total) {
            free(hbuf); goto fail;
        }
        free(hbuf);
    }

    /* Adjust out_offsets to be absolute file positions */
    for (uint64_t i = 0; i < ctx.n_tensors; i++)
        out_offsets[i] += header_total;

    /* ── Thread pool ── */
    {
        pthread_t *threads = (pthread_t *)malloc(nthreads * sizeof(pthread_t));
        if (!threads) goto fail;

        thread_pool pool = {
            .mu         = PTHREAD_MUTEX_INITIALIZER,
            .cond_work  = PTHREAD_COND_INITIALIZER,
            .cond_done  = PTHREAD_COND_INITIALIZER,
            .ctx        = &ctx,
            .out_fd     = out_fd,
            .out_offsets= out_offsets,
            .out_type   = otype,
            .pure       = pure,
            .done_count = 0,
            .total      = (int)ctx.n_tensors,
            .start      = now_sec(),
        };
        g_pool = &pool;

        for (int i = 0; i < nthreads; i++)
            pthread_create(&threads[i], NULL, worker_fn, &pool);

        /* Submit all tensors */
        pthread_mutex_lock(&pool.mu);
        for (uint64_t i = 0; i < ctx.n_tensors; i++) {
            work_item *item = (work_item *)malloc(sizeof(work_item));
            item->tensor_idx = i;
            item->next = NULL;
            /* Append to tail for sequential mmap access */
            if (!pool.head) { pool.head = item; }
            else {
                work_item *tail = pool.head;
                while (tail->next) tail = tail->next;
                tail->next = item;
            }
            pool.n_pending++;
        }
        pthread_cond_broadcast(&pool.cond_work);

        /* Wait for all work to finish */
        while (pool.n_pending > 0)
            pthread_cond_wait(&pool.cond_done, &pool.mu);
        pool.shutdown = 1;
        pthread_cond_broadcast(&pool.cond_work);
        pthread_mutex_unlock(&pool.mu);

        for (int i = 0; i < nthreads; i++) pthread_join(threads[i], NULL);
        free(threads);
    }

    close(out_fd);
    munmap(inp_map, inp_size);
    close(inp_fd);
    free(out_offsets);
    free(ctx.tensors);

    /* Validate + atomic rename */
    {
        FILE *f = fopen(tmp_path, "rb");
        char magic_check[4] = {0};
        if (!f || fread(magic_check, 1, 4, f) != 4 ||
            memcmp(magic_check, "GGUF", 4) != 0) {
            if (f) fclose(f);
            fprintf(stderr, "\n  ERROR: output GGUF validation failed\n");
            unlink(tmp_path);
            return 1;
        }
        fclose(f);
    }
    if (rename(tmp_path, out_path) != 0) {
        perror("rename"); unlink(tmp_path); return 1;
    }
    return 0;

fail:
    close(out_fd);
    munmap(inp_map, inp_size);
    close(inp_fd);
    free(out_offsets);
    free(ctx.tensors);
    unlink(tmp_path);
    return 1;
}

/* ── llama.cpp path (K-quants) ───────────────────────────────────────────────── */

typedef int32_t llama_ftype;
typedef int32_t ggml_type_llama;

#define LLAMA_FTYPE_MOSTLY_Q2_K    10
#define LLAMA_FTYPE_MOSTLY_Q3_K_M  12
#define LLAMA_FTYPE_MOSTLY_Q4_K_M  15
#define LLAMA_FTYPE_MOSTLY_Q5_K_M  17
#define LLAMA_FTYPE_MOSTLY_Q6_K    18

struct llama_model_quantize_params {
    int32_t          nthread;
    llama_ftype      ftype;
    ggml_type_llama  output_tensor_type;
    ggml_type_llama  token_embeddings_tensor_type;
    bool             allow_requantize;
    bool             quantize_output_tensor;
    bool             only_copy;
    bool             pure;
    bool             keep_split;
    void            *imatrix;
    void            *kv_overrides;
};

extern void     llama_backend_init(void);
extern void     llama_backend_free(void);
extern struct   llama_model_quantize_params llama_model_quantize_default_params(void);
extern uint32_t llama_model_quantize(const char*, const char*,
                                     const struct llama_model_quantize_params*);
extern void     llama_log_set(void (*)(int,const char*,void*), void*);

struct progress_ctx { int cur,tot,last_pct; double start; };
static struct progress_ctx g_pctx;

static void progress_log_cb(int level, const char *text, void *ud) {
    (void)level;
    struct progress_ctx *c = (struct progress_ctx *)ud;
    int cur=0,tot=0;
    if (sscanf(text," [ %d/%d]",&cur,&tot)!=2||tot<=0) return;
    c->cur=cur; c->tot=tot;
    int pct = cur*100/tot;
    if (pct==c->last_pct && cur!=tot) return;
    c->last_pct=pct;
    double el=now_sec()-c->start;
    int filled=pct/4; char bar[26];
    for(int i=0;i<25;i++) bar[i]=(i<filled?'#':'.'); bar[25]=0;
    double eta=(pct>0&&pct<100)?el*(100.0-pct)/pct:0.0;
    if(pct<100) fprintf(stderr,"\r  [%s] %3d%%  %d/%d tensors  %.0fs  ETA %.0fs   ",
                        bar,pct,cur,tot,el,eta);
    else        fprintf(stderr,"\r  [%s] 100%%  %d tensors  %.0fs            \n",
                        bar,tot,el);
    fflush(stderr);
}

static llama_ftype parse_k_ftype(const char *s) {
    if (!strcmp(s,"Q2_K"))   return LLAMA_FTYPE_MOSTLY_Q2_K;
    if (!strcmp(s,"Q3_K_M")) return LLAMA_FTYPE_MOSTLY_Q3_K_M;
    if (!strcmp(s,"Q4_K_M")) return LLAMA_FTYPE_MOSTLY_Q4_K_M;
    if (!strcmp(s,"Q5_K_M")) return LLAMA_FTYPE_MOSTLY_Q5_K_M;
    if (!strcmp(s,"Q6_K"))   return LLAMA_FTYPE_MOSTLY_Q6_K;
    return -1;
}

static int llama_quantize_path(const char *inp, const char *out,
                                const char *type, int nthreads, bool pure) {
    llama_ftype ftype = parse_k_ftype(type);
    if (ftype < 0) { fprintf(stderr,"Unknown K-quant type: %s\n",type); return 1; }

    char tmp[4096]; snprintf(tmp,sizeof(tmp),"%s.tmp",out);

    llama_backend_init();
    g_pctx.cur=0; g_pctx.tot=0; g_pctx.last_pct=-1; g_pctx.start=now_sec();
    llama_log_set(progress_log_cb, &g_pctx);

    struct llama_model_quantize_params p = llama_model_quantize_default_params();
    p.ftype                  = ftype;
    p.nthread                = nthreads;
    p.allow_requantize       = true;
    p.quantize_output_tensor = false;
    p.pure                   = pure;
    p.keep_split             = false;

    uint32_t err = llama_model_quantize(inp, tmp, &p);
    llama_backend_free();
    if (err != 0) { fprintf(stderr,"\n  ERROR: llama_model_quantize failed (%u)\n",err); unlink(tmp); return 1; }

    /* Validate */
    FILE *f = fopen(tmp,"rb"); char mc[4]={0};
    if (!f || fread(mc,1,4,f)!=4 || memcmp(mc,"GGUF",4)) {
        if(f) fclose(f); unlink(tmp);
        fprintf(stderr,"\n  ERROR: output GGUF validation failed\n"); return 1;
    }
    fclose(f);
    if (rename(tmp,out)!=0) { perror("rename"); unlink(tmp); return 1; }
    return 0;
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

static long long file_size_bytes(const char *p) {
    struct stat st; return stat(p,&st)==0?(long long)st.st_size:-1LL;
}

static int cpu_count(void) {
#if defined(_SC_NPROCESSORS_ONLN)
    long n=sysconf(_SC_NPROCESSORS_ONLN); return n>0?(int)n:1;
#else
    return 1;
#endif
}

/* ── main ────────────────────────────────────────────────────────────────────── */

int main(int argc, char **argv) {
    select_simd_kernels();

    int  opt_threads = -1;
    bool opt_pure    = false;
    int  i           = 1;

    for (; i < argc; i++) {
        if (!strcmp(argv[i],"--threads") && i+1<argc) {
            opt_threads = atoi(argv[++i]);
            if (opt_threads < 1) opt_threads = 1;
        } else if (!strcmp(argv[i],"--pure")) {
            opt_pure = true;
        } else {
            break;
        }
    }

    if (argc - i < 2) {
        fprintf(stderr,
            "Usage: oc-quant [--threads N] [--pure] <input.gguf> <output.gguf> [TYPE]\n\n"
            "  Stream mode (fast, O(tensor) RAM):   Q4_0  Q8_0\n"
            "  Quality mode (K-quants via llama):   Q4_K_M (default)  Q5_K_M  Q3_K_M  Q2_K  Q6_K\n"
            "  --threads N  thread count (stream default: all CPUs; K-quant: nCPU-1)\n"
            "  --pure       quantize embeddings and output tensors too\n");
        return 1;
    }

    const char *inp  = argv[i];
    const char *out  = argv[i+1];
    const char *type = (i+2 < argc) ? argv[i+2] : "Q4_K_M";

    /* Determine mode */
    bool stream_mode = !strcmp(type,"Q4_0") || !strcmp(type,"Q8_0");
    uint32_t stream_otype = (!strcmp(type,"Q8_0")) ? GGML_TYPE_Q8_0 : GGML_TYPE_Q4_0;

    int nthreads;
    if (opt_threads > 0) {
        nthreads = opt_threads;
    } else if (stream_mode) {
        nthreads = cpu_count();  /* use all for stream — it's embarrassingly parallel */
    } else {
        nthreads = cpu_count() - 1;
        if (nthreads < 1) nthreads = 1;
    }

    long long in_bytes = file_size_bytes(inp);
    char in_sz[32], out_sz[32];
    fmt_size(in_bytes, in_sz, sizeof(in_sz));

    fprintf(stderr,
        "\n  oc-quant  [%s mode]\n"
        "  Input : %s (%s)\n"
        "  Output: %s  →  %s\n"
        "  Threads: %d%s\n\n",
        stream_mode ? "STREAM" : "K-QUANT",
        inp, in_sz, type, out,
        nthreads, opt_pure ? "  [--pure]" : "");
    fflush(stderr);

    double t0 = now_sec();
    int rc = stream_mode
        ? stream_quantize(inp, out, stream_otype, nthreads, opt_pure)
        : llama_quantize_path(inp, out, type, nthreads, opt_pure);

    if (rc == 0) {
        long long out_bytes = file_size_bytes(out);
        fmt_size(out_bytes, out_sz, sizeof(out_sz));
        double ratio  = (in_bytes>0&&out_bytes>0) ? (double)in_bytes/out_bytes : 0.0;
        double saved  = (in_bytes>0&&out_bytes>0) ? 100.0*(1.0-(double)out_bytes/in_bytes) : 0.0;
        double elapsed = now_sec() - t0;
        fprintf(stderr,
            "\n  Done in %.1fs\n"
            "  %s  →  %s  (%.1fx smaller, %.1f%% saved)\n\n",
            elapsed, in_sz, out_sz, ratio, saved);
        fprintf(stdout, "ok bytes_in=%lld bytes_out=%lld ratio=%.3f elapsed=%.1f\n",
                in_bytes, out_bytes, ratio, elapsed);
    }
    return rc;
}
