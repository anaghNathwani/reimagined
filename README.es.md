<p align="center">
  <a href="https://reimagined.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Reimagined logo">
    </picture>
  </a>
</p>
<p align="center">El agente de programación con IA de código abierto.</p>
<p align="center">
  <a href="https://reimagined.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/reimagined-ai"><img alt="npm" src="https://img.shields.io/npm/v/reimagined-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/reimagined/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/reimagined/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Reimagined Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://reimagined.ai)

---

### Instalación

```bash
# YOLO
curl -fsSL https://reimagined.ai/install | bash

# Gestores de paquetes
npm i -g reimagined-ai@latest        # o bun/pnpm/yarn
scoop install reimagined             # Windows
choco install reimagined             # Windows
brew install anomalyco/tap/reimagined # macOS y Linux (recomendado, siempre al día)
brew install reimagined              # macOS y Linux (fórmula oficial de brew, se actualiza menos)
sudo pacman -S reimagined            # Arch Linux (Stable)
paru -S reimagined-bin               # Arch Linux (Latest from AUR)
mise use -g reimagined               # cualquier sistema
nix run nixpkgs#reimagined           # o github:anomalyco/reimagined para la rama dev más reciente
```

> [!TIP]
> Elimina versiones anteriores a 0.1.x antes de instalar.

### App de escritorio (BETA)

Reimagined también está disponible como aplicación de escritorio. Descárgala directamente desde la [página de releases](https://github.com/anomalyco/reimagined/releases) o desde [reimagined.ai/download](https://reimagined.ai/download).

| Plataforma            | Descarga                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `reimagined-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `reimagined-desktop-mac-x64.dmg`     |
| Windows               | `reimagined-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, o AppImage         |

```bash
# macOS (Homebrew)
brew install --cask reimagined-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/reimagined-desktop
```

#### Directorio de instalación

El script de instalación respeta el siguiente orden de prioridad para la ruta de instalación:

1. `$OPENCODE_INSTALL_DIR` - Directorio de instalación personalizado
2. `$XDG_BIN_DIR` - Ruta compatible con la especificación XDG Base Directory
3. `$HOME/bin` - Directorio binario estándar del usuario (si existe o se puede crear)
4. `$HOME/.reimagined/bin` - Alternativa por defecto

```bash
# Ejemplos
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://reimagined.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://reimagined.ai/install | bash
```

### Agentes

Reimagined incluye dos agentes integrados que puedes alternar con la tecla `Tab`.

- **build** - Por defecto, agente con acceso completo para tareas de desarrollo
- **plan** - Agente de solo lectura para análisis y exploración de código
  - Deniega ediciones de archivos por defecto
  - Pide permiso antes de ejecutar comandos bash
  - Ideal para explorar codebases desconocidas o planificar cambios

Además, incluye un subagente **general** para búsquedas complejas y tareas de varios pasos.
Se usa internamente y se puede invocar con `@general` en los mensajes.

Más información sobre [agentes](https://reimagined.ai/docs/agents).

### Documentación

Para más información sobre cómo configurar Reimagined, [**ve a nuestra documentación**](https://reimagined.ai/docs).

### Contribuir

Si te interesa contribuir a Reimagined, lee nuestras [docs de contribución](./CONTRIBUTING.md) antes de enviar un pull request.

### Proyectos basados en Reimagined

Si estás trabajando en un proyecto basado en Reimagined y usas "reimagined" como parte del nombre, por ejemplo, "reimagined-dashboard" u "reimagined-mobile", agrega una nota en tu README para aclarar que no está hecho por el equipo de Reimagined y que no está afiliado con nosotros de ninguna manera.

---

**Únete a nuestra comunidad** [Discord](https://discord.gg/reimagined) | [X.com](https://x.com/reimagined)
