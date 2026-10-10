#!/bin/bash
# Pasang Claude Buddy dari source ini.
# Jalankan sebagai user desktop biasa (bukan root):  ./install.sh
# Bagian sistem (/usr/local, systemd, polkit) dipasang lewat sudo.
set -euo pipefail

cd "$(dirname "$0")"
UUID="claude-buddy@yandi"
TARGET_USER="${USER}"

if [ "$(id -u)" -eq 0 ]; then
    echo "Jalankan sebagai user desktop, bukan root." >&2
    exit 1
fi

echo "==> File user"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$EXT_DIR" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/scalable/apps"
cp extension/"$UUID"/* "$EXT_DIR/"
cp desktop/io.claude.buddy.desktop "$HOME/.local/share/applications/"
cp icons/claude-buddy.svg "$HOME/.local/share/icons/hicolor/scalable/apps/"

echo "==> File sistem (sudo)"
sudo install -m 755 bin/claude-buddy-launch bin/claude-buddy-switch bin/claude-sudo /usr/local/bin/
# Script status & polkit menyebut nama user; sesuaikan dengan user yang memasang
sed "s|('yandi', '/home/yandi')|('$TARGET_USER', '$HOME')|" bin/claude-buddy-status \
    | sudo install -m 755 /dev/stdin /usr/local/bin/claude-buddy-status
sudo install -d -m 755 /usr/local/lib/claude-buddy/bin
sed "s|:-yandi}|:-$TARGET_USER}|" lib/open-in-user-chrome \
    | sudo install -m 755 /dev/stdin /usr/local/lib/claude-buddy/open-in-user-chrome
for name in sensible-browser www-browser x-www-browser xdg-open; do
    sudo ln -sf ../open-in-user-chrome "/usr/local/lib/claude-buddy/bin/$name"
done
sudo install -m 644 systemd/claude-buddy-status.service systemd/claude-buddy-status.timer /etc/systemd/system/
sed "s|subject.user == \"yandi\"|subject.user == \"$TARGET_USER\"|" polkit/49-claude-buddy-status.rules \
    | sudo install -m 644 /dev/stdin /etc/polkit-1/rules.d/49-claude-buddy-status.rules

sudo systemctl daemon-reload
sudo systemctl enable --now claude-buddy-status.timer

echo "==> Aktifkan ekstensi"
gnome-extensions enable "$UUID" 2>/dev/null \
    || echo "   Logout/login dulu, lalu: gnome-extensions enable $UUID"

echo "Selesai! 👑"
