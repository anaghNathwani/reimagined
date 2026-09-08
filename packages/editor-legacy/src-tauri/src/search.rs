use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct SearchMatch {
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub text: String,
}

/// Full-text search using ripgrep if available, otherwise grep.
pub fn search_text(
    query: &str,
    cwd: &str,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
) -> Result<Vec<SearchMatch>, String> {
    let rg = find_rg();
    if let Some(rg) = rg {
        run_ripgrep(&rg, query, cwd, case_sensitive, whole_word, use_regex)
    } else {
        run_grep(query, cwd, case_sensitive, whole_word)
    }
}

fn run_ripgrep(
    rg: &str,
    query: &str,
    cwd: &str,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
) -> Result<Vec<SearchMatch>, String> {
    let mut cmd = Command::new(rg);
    cmd.current_dir(cwd)
        .arg("--line-number")
        .arg("--column")
        .arg("--no-heading")
        .arg("--color=never")
        .arg("--max-count=200")
        .arg("--max-filesize=1M");

    if !case_sensitive { cmd.arg("--ignore-case"); }
    if whole_word     { cmd.arg("--word-regexp"); }
    if !use_regex     { cmd.arg("--fixed-strings"); }

    // Common ignores
    for dir in &["node_modules", ".git", "target", "dist", "build", ".next"] {
        cmd.arg("--glob").arg(format!("!{dir}/**"));
    }

    cmd.arg("--").arg(query);

    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    parse_rg_output(&stdout)
}

fn parse_rg_output(text: &str) -> Result<Vec<SearchMatch>, String> {
    let mut results = Vec::new();
    for line in text.lines().take(500) {
        // format: file:line:col:text
        let parts: Vec<&str> = line.splitn(4, ':').collect();
        if parts.len() < 4 { continue; }
        let Ok(ln) = parts[1].parse::<u32>() else { continue };
        let Ok(col) = parts[2].parse::<u32>() else { continue };
        results.push(SearchMatch {
            file: parts[0].to_string(),
            line: ln,
            col,
            text: parts[3].trim_end().to_string(),
        });
    }
    Ok(results)
}

fn run_grep(query: &str, cwd: &str, case_sensitive: bool, whole_word: bool) -> Result<Vec<SearchMatch>, String> {
    let mut cmd = Command::new("grep");
    cmd.current_dir(cwd).arg("-rn").arg("--color=never");
    if !case_sensitive { cmd.arg("-i"); }
    if whole_word     { cmd.arg("-w"); }
    cmd.arg("--exclude-dir=node_modules")
        .arg("--exclude-dir=.git")
        .arg("--exclude-dir=target")
        .arg("--").arg(query).arg(".");

    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut results = Vec::new();
    for line in stdout.lines().take(500) {
        let parts: Vec<&str> = line.splitn(3, ':').collect();
        if parts.len() < 3 { continue; }
        let Ok(ln) = parts[1].parse::<u32>() else { continue };
        results.push(SearchMatch {
            file: parts[0].trim_start_matches("./").to_string(),
            line: ln,
            col: 1,
            text: parts[2].trim_end().to_string(),
        });
    }
    Ok(results)
}

/// Fuzzy-ish file listing (all files, respecting common ignores).
pub fn find_files(cwd: &str, pattern: &str) -> Result<Vec<String>, String> {
    let rg = find_rg();
    let files: Vec<String> = if let Some(rg) = rg {
        let out = Command::new(&rg)
            .current_dir(cwd)
            .args(["--files", "--color=never", "--max-filesize=10M",
                   "--glob", "!node_modules/**",
                   "--glob", "!.git/**",
                   "--glob", "!target/**",
                   "--glob", "!dist/**",
                   "--glob", "!build/**",
                   "--glob", "!.next/**"])
            .output()
            .map_err(|e| e.to_string())?;
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|s| s.to_string())
            .collect()
    } else {
        let out = Command::new("find")
            .current_dir(cwd)
            .args([".", "-type", "f",
                   "-not", "-path", "*/node_modules/*",
                   "-not", "-path", "*/.git/*",
                   "-not", "-path", "*/target/*",
                   "-not", "-name", ".DS_Store"])
            .output()
            .map_err(|e| e.to_string())?;
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|s| s.trim_start_matches("./").to_string())
            .collect()
    };

    // Score by how well the pattern matches (simple substring)
    let pat = pattern.to_lowercase();
    let mut scored: Vec<(i32, String)> = files
        .into_iter()
        .filter(|f| {
            if pat.is_empty() { return true; }
            fuzzy_match(f, &pat)
        })
        .map(|f| {
            let score = score_match(&f, &pat);
            (score, f)
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(scored.into_iter().take(100).map(|(_, f)| f).collect())
}

fn fuzzy_match(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() { return true; }
    let h = haystack.to_lowercase();
    // All chars of needle must appear in order in haystack
    let mut ni = needle.chars().peekable();
    for c in h.chars() {
        if ni.peek() == Some(&c) { ni.next(); }
        if ni.peek().is_none() { return true; }
    }
    false
}

fn score_match(path: &str, pat: &str) -> i32 {
    if pat.is_empty() { return 0; }
    let filename = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    let mut score = 0i32;
    if filename.contains(pat) { score += 100; }
    if filename.starts_with(pat) { score += 50; }
    if path.to_lowercase().contains(pat) { score += 10; }
    score
}

fn find_rg() -> Option<String> {
    // rg is bundled by claude-code on this machine, find the real one
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            let candidate = std::path::Path::new(dir).join("rg");
            if candidate.exists() {
                // Quick check: real ripgrep responds to --version
                if let Ok(out) = Command::new(&candidate).arg("--version").output() {
                    let v = String::from_utf8_lossy(&out.stdout);
                    if v.contains("ripgrep") {
                        return Some(candidate.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }
    None
}

/// Parse `git diff --unified=0` output to get changed line ranges per file.
#[derive(Serialize)]
pub struct FileDiff {
    pub path: String,
    pub added: Vec<[u32; 2]>,   // [start, end] line ranges (1-indexed)
    pub deleted: Vec<u32>,       // line numbers in new file where deletions occurred
    pub modified: Vec<[u32; 2]>,
}

pub fn git_diff(cwd: &str) -> Result<Vec<FileDiff>, String> {
    let out = Command::new("git")
        .current_dir(cwd)
        .args(["diff", "HEAD", "--unified=0", "--diff-filter=ACMRT"])
        .output()
        .map_err(|e| e.to_string())?;

    let text = String::from_utf8_lossy(&out.stdout);
    let mut diffs: Vec<FileDiff> = Vec::new();
    let mut current: Option<FileDiff> = None;

    for line in text.lines() {
        if line.starts_with("--- ") || line.starts_with("diff --git") {
            continue;
        }
        if line.starts_with("+++ b/") {
            if let Some(d) = current.take() { diffs.push(d); }
            current = Some(FileDiff {
                path: line["+++ b/".len()..].to_string(),
                added: vec![], deleted: vec![], modified: vec![],
            });
        } else if line.starts_with("@@ ") {
            // @@ -old_start[,old_count] +new_start[,new_count] @@
            if let Some(ref mut d) = current {
                if let Some((del, add)) = parse_hunk(line) {
                    if add[1] == 0 {
                        // Pure deletion
                        d.deleted.push(add[0]);
                    } else if del[1] == 0 {
                        // Pure addition
                        d.added.push([add[0], add[0] + add[1].saturating_sub(1)]);
                    } else {
                        // Modification
                        d.modified.push([add[0], add[0] + add[1].saturating_sub(1)]);
                    }
                }
            }
        }
    }
    if let Some(d) = current { diffs.push(d); }
    Ok(diffs)
}

fn parse_hunk(line: &str) -> Option<([u32; 2], [u32; 2])> {
    // @@ -a[,b] +c[,d] @@
    let inner = line.trim_start_matches("@@ ").split(" @@").next()?;
    let mut parts = inner.split_whitespace();
    let del = parse_range(parts.next()?.trim_start_matches('-'))?;
    let add = parse_range(parts.next()?.trim_start_matches('+'))?;
    Some((del, add))
}

fn parse_range(s: &str) -> Option<[u32; 2]> {
    let mut it = s.splitn(2, ',');
    let start: u32 = it.next()?.parse().ok()?;
    let count: u32 = it.next().and_then(|c| c.parse().ok()).unwrap_or(1);
    Some([start, count])
}
