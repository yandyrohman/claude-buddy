# CLAUDE.md

Panduan untuk Claude Code saat bekerja di repo ini. Pemilik repo berbahasa Indonesia; balas dalam Bahasa Indonesia.

## Apa ini

Teman Ngoding = ekstensi GNOME Shell (maskot piksel di desktop; karakter Claude/Gemini/Codex/OpenCode)
+ beberapa script pendukung untuk membuka CLI AI sebagai root dan menampilkan info akun/limit. Tidak ada proses build;
semua file disalin apa adanya ke lokasi sistem.

## Cara memasang (kalau user minta "install")

1. **Cek kebutuhan dulu**, laporkan yang kurang sebelum memasang:
   ```bash
   gnome-shell --version          # harus cocok dengan "shell-version" di extension/teman-ngoding@yandi/metadata.json
   which ptyxis google-chrome python3 sudo gnome-extensions
   sudo test -x /root/.local/bin/claude && echo ok   # Claude Code untuk root
   sudo test -x /root/.local/bin/agy && echo ok      # Antigravity CLI untuk karakter Gemini (opsional)
   which codex opencode                              # CLI lain (opsional, npm global)
   ```
   - Versi GNOME beda → tambahkan versinya ke `shell-version` di `metadata.json` (tanya user dulu).
   - Claude Code root belum ada → pasang dengan `sudo bash -c 'curl -fsSL https://claude.ai/install.sh | bash'`, lalu login lewat `bin/teman-ngoding-switch claude`.
   - Antigravity CLI root belum ada → `sudo bash -c 'curl -fsSL https://antigravity.google/cli/install.sh | bash'`.
   - `ptyxis` tidak ada → tanyakan terminal apa yang dipakai, lalu ganti baris `exec ptyxis ...` di `bin/teman-ngoding-launch`.

2. **Jalankan installer**:
   ```bash
   ./install.sh                          # sebagai user desktop, butuh sudo
   sudo TARGET_USER=yandi ./install.sh   # kalau sesi ini root
   ```
   Installer juga membersihkan instalasi Claude Buddy lama. Kalau sudo tidak bisa interaktif
   di sesi ini, minta user menjalankannya sendiri dengan mengetik `! ./install.sh`.

3. **Verifikasi**:
   ```bash
   gnome-extensions info teman-ngoding@yandi      # State: ACTIVE
   systemctl status teman-ngoding-status.timer    # active (waiting)
   sudo systemctl start teman-ngoding-status.service && cat /run/teman-ngoding/status.json
   ```
   Di Wayland, ekstensi baru sering belum dikenali sampai **logout/login**. Kalau `gnome-extensions enable`
   gagal setelah install pertama, minta user logout lalu login lagi, lalu jalankan
   `gnome-extensions enable teman-ngoding@yandi`.

## Hal penting

- `install.sh` mengganti nama user `yandi` (di `teman-ngoding-status`, `open-in-user-chrome`, aturan polkit)
  dengan `$USER` saat dipasang. File di repo tetap memakai `yandi`; jangan ubah pola itu tanpa menyesuaikan `sed` di `install.sh`.
- UUID ekstensi `teman-ngoding@yandi` dipakai di `metadata.json`, `buddy.js`, `bin/teman-ngoding-launch`,
  `install.sh`, dan nama folder. Kalau diganti, ganti di semua tempat.
- `buddy.js` membaca `accounts.root` / `accounts.yandi` dari `status.json` (Claude), jadi untuk user lain
  akun non-root tidak tampil sebagai cadangan. Ini bukan masalah selama Claude Code root sudah login.
- Karakter didefinisikan di `CHARACTERS` (`buddy.js`). Id karakter (`claude`, `gemini`, `codex`, `opencode`)
  juga dipakai di `case` pada `bin/teman-ngoding-{run,launch,switch}`, di `AGENTS` pada `teman-ngoding-status`,
  dan di kelas CSS `ngoding-theme-<id>` / `ngoding-chip-<id>`. Tambah karakter = ubah semua tempat itu.
- Sisa limit (dan maskot tidur saat limit habis) hanya untuk Claude; karakter lain hanya menampilkan info akun.
- **Jangan pernah commit** `.credentials.json`, `.claude.json`, `oauth_creds.json`, `auth.json`, `.env`, atau
  `status.json`. Token OAuth / API key hanya boleh dibaca oleh `teman-ngoding-status` (berjalan sebagai root) dan tidak boleh ditulis ke output.

## Mengembangkan

Setelah mengubah file ekstensi, salin lalu muat ulang (tidak perlu logout, karena `extension.js`
meng-import salinan `buddy.js` dengan nama unik):
```bash
cp extension/teman-ngoding@yandi/* ~/.local/share/gnome-shell/extensions/teman-ngoding@yandi/
gnome-extensions disable teman-ngoding@yandi && gnome-extensions enable teman-ngoding@yandi
```
Log error: `journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i ngoding`.
Perubahan di `metadata.json` atau `extension.js` tetap butuh logout/login.

Script di `bin/` / `lib/` / `systemd/` / `polkit/` → pasang ulang dengan `./install.sh`.

## Copot pasang

```bash
gnome-extensions disable teman-ngoding@yandi
rm -rf ~/.local/share/gnome-shell/extensions/teman-ngoding@yandi \
       ~/.local/share/applications/teman-ngoding.desktop \
       ~/.local/share/icons/hicolor/scalable/apps/teman-ngoding.svg \
       ~/.config/teman-ngoding.json
sudo systemctl disable --now teman-ngoding-status.timer
sudo rm -rf /usr/local/bin/teman-ngoding-{launch,status,switch,run} \
            /usr/local/lib/teman-ngoding /run/teman-ngoding \
            /etc/systemd/system/teman-ngoding-status.{service,timer} \
            /etc/polkit-1/rules.d/49-teman-ngoding-status.rules
sudo systemctl daemon-reload
```
Konfirmasi ke user sebelum menjalankan ini.
