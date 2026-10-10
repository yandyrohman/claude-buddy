# Claude Buddy 👑

Maskot Clawd bermahkota yang hidup di desktop GNOME. Dia mengambang, berkedip,
ngobrol, dan bisa diklik untuk membuka Claude Code (sebagai root) di terminal.
Dia juga menampilkan info akun dan sisa limit Claude Code.

## Isi repo

| Folder | Isi | Dipasang ke |
|---|---|---|
| `extension/claude-buddy@yandi/` | Ekstensi GNOME Shell (`buddy.js` = maskot, `extension.js` = pemuat) | `~/.local/share/gnome-shell/extensions/` |
| `bin/claude-buddy-launch` | Dipanggil ikon aplikasi: nyalakan maskot / buka Claude Code | `/usr/local/bin/` |
| `bin/claude-sudo` | Jalankan Claude Code sebagai root | `/usr/local/bin/` |
| `bin/claude-buddy-switch` | Ganti akun Claude Code (login via Chrome user) | `/usr/local/bin/` |
| `bin/claude-buddy-status` | Ambil info akun + pemakaian limit → `/run/claude-buddy/status.json` | `/usr/local/bin/` |
| `lib/open-in-user-chrome` | Buka URL login di Chrome milik user (bukan root) | `/usr/local/lib/claude-buddy/` |
| `systemd/` | Service + timer status (tiap 3 menit) | `/etc/systemd/system/` |
| `polkit/` | Izinkan user menjalankan service status tanpa password | `/etc/polkit-1/rules.d/` |
| `desktop/`, `icons/` | Launcher aplikasi + ikon | `~/.local/share/` |

## Kebutuhan

- GNOME Shell 50 (lihat `metadata.json`)
- [Claude Code](https://claude.com/claude-code) terpasang untuk root di `/root/.local/bin/claude`
- `ptyxis` (terminal), `google-chrome`, `python3`, `sudo`

## Pasang

```bash
./install.sh
```

Script akan menyalin file user, memasang bagian sistem lewat `sudo`,
menyesuaikan nama user di script status/polkit, lalu mengaktifkan ekstensi.

## Mengembangkan

Setelah mengubah `buddy.js`, salin ke folder ekstensi lalu muat ulang tanpa logout:

```bash
cp extension/claude-buddy@yandi/* ~/.local/share/gnome-shell/extensions/claude-buddy@yandi/
gnome-extensions disable claude-buddy@yandi && gnome-extensions enable claude-buddy@yandi
```

`extension.js` menyalin `buddy.js` ke nama unik di `$XDG_RUNTIME_DIR` sebelum di-import,
jadi versi baru langsung terpakai.

## Catatan keamanan

`claude-buddy-status` membaca token OAuth Claude Code untuk mengecek limit, tapi
token **tidak** ditulis ke file output. Jangan pernah commit file `.credentials.json`
atau `.claude.json` ke repo ini.
