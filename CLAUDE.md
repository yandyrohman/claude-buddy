# CLAUDE.md

Panduan untuk Claude Code saat bekerja di repo ini. Pemilik repo berbahasa Indonesia; balas dalam Bahasa Indonesia.

## Apa ini

Claude Buddy = ekstensi GNOME Shell (maskot Clawd bermahkota di desktop) + beberapa script pendukung
untuk membuka Claude Code sebagai root dan menampilkan info akun/limit. Tidak ada proses build;
semua file disalin apa adanya ke lokasi sistem.

## Cara memasang (kalau user minta "install")

1. **Cek kebutuhan dulu**, laporkan yang kurang sebelum memasang:
   ```bash
   gnome-shell --version          # harus cocok dengan "shell-version" di extension/claude-buddy@yandi/metadata.json
   which ptyxis google-chrome python3 sudo gnome-extensions
   sudo test -x /root/.local/bin/claude && echo ok   # Claude Code untuk root
   ```
   - Versi GNOME beda → tambahkan versinya ke `shell-version` di `metadata.json` (tanya user dulu).
   - Claude Code root belum ada → pasang dengan `sudo bash -c 'curl -fsSL https://claude.ai/install.sh | bash'`, lalu login lewat `bin/claude-buddy-switch`.
   - `ptyxis` tidak ada → tanyakan terminal apa yang dipakai, lalu ganti baris `exec ptyxis ...` di `bin/claude-buddy-launch`.

2. **Jalankan installer sebagai user desktop (bukan root)**:
   ```bash
   ./install.sh
   ```
   Butuh sudo (password user). Kalau perintah sudo tidak bisa interaktif di sesi ini, minta user
   menjalankannya sendiri dengan mengetik `! ./install.sh`.

3. **Verifikasi**:
   ```bash
   gnome-extensions info claude-buddy@yandi       # State: ACTIVE
   systemctl status claude-buddy-status.timer     # active (waiting)
   sudo systemctl start claude-buddy-status.service && cat /run/claude-buddy/status.json
   ```
   Di Wayland, ekstensi baru sering belum dikenali sampai **logout/login**. Kalau `gnome-extensions enable`
   gagal setelah install pertama, minta user logout lalu login lagi, lalu jalankan
   `gnome-extensions enable claude-buddy@yandi`.

## Hal penting

- `install.sh` mengganti nama user `yandi` (di `claude-buddy-status`, `open-in-user-chrome`, aturan polkit)
  dengan `$USER` saat dipasang. File di repo tetap memakai `yandi`; jangan ubah pola itu tanpa menyesuaikan `sed` di `install.sh`.
- UUID ekstensi `claude-buddy@yandi` dipakai di `metadata.json`, `buddy.js`, `bin/claude-buddy-launch`,
  dan nama folder. Kalau diganti, ganti di semua tempat.
- `buddy.js` membaca `accounts.root` / `accounts.yandi` dari `status.json`, jadi untuk user lain
  akun non-root tidak tampil sebagai cadangan. Ini bukan masalah selama Claude Code root sudah login.
- **Jangan pernah commit** `.credentials.json`, `.claude.json`, atau `status.json`. Token OAuth hanya boleh
  dibaca oleh `claude-buddy-status` (berjalan sebagai root) dan tidak boleh ditulis ke output.

## Mengembangkan

Setelah mengubah file ekstensi, salin lalu muat ulang (tidak perlu logout, karena `extension.js`
meng-import salinan `buddy.js` dengan nama unik):
```bash
cp extension/claude-buddy@yandi/* ~/.local/share/gnome-shell/extensions/claude-buddy@yandi/
gnome-extensions disable claude-buddy@yandi && gnome-extensions enable claude-buddy@yandi
```
Log error: `journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i buddy`.
Perubahan di `metadata.json` atau `extension.js` tetap butuh logout/login.

Script di `bin/` / `lib/` / `systemd/` / `polkit/` → pasang ulang dengan `./install.sh`.

## Copot pasang

```bash
gnome-extensions disable claude-buddy@yandi
rm -rf ~/.local/share/gnome-shell/extensions/claude-buddy@yandi \
       ~/.local/share/applications/io.claude.buddy.desktop \
       ~/.local/share/icons/hicolor/scalable/apps/claude-buddy.svg \
       ~/.config/claude-buddy.json
sudo systemctl disable --now claude-buddy-status.timer
sudo rm -rf /usr/local/bin/claude-buddy-{launch,status,switch} /usr/local/bin/claude-sudo \
            /usr/local/lib/claude-buddy /run/claude-buddy \
            /etc/systemd/system/claude-buddy-status.{service,timer} \
            /etc/polkit-1/rules.d/49-claude-buddy-status.rules
sudo systemctl daemon-reload
```
Konfirmasi ke user sebelum menjalankan ini.
