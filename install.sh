#!/bin/bash
# Pasang Teman Ngoding dari source ini (sekaligus mengganti Claude Buddy versi lama).
# Jalankan sebagai user desktop biasa:   ./install.sh
# atau sebagai root untuk user tertentu: sudo TARGET_USER=yandi ./install.sh
# Bagian sistem (/usr/local, systemd, polkit) dipasang lewat sudo.
set -euo pipefail

cd "$(dirname "$0")"
UUID="teman-ngoding@yandi"
OLD_UUID="claude-buddy@yandi"

if [ "$(id -u)" -eq 0 ]; then
    TARGET_USER="${TARGET_USER:-${SUDO_USER:-}}"
    if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = root ]; then
        echo "Sebagai root, tentukan user desktop: TARGET_USER=nama ./install.sh" >&2
        exit 1
    fi
    SUDO=""
    TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
    TARGET_UID="$(id -u "$TARGET_USER")"
    as_user() {
        runuser -u "$TARGET_USER" -- env HOME="$TARGET_HOME" \
            XDG_RUNTIME_DIR="/run/user/$TARGET_UID" \
            DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$TARGET_UID/bus" "$@"
    }
else
    TARGET_USER="$USER"
    TARGET_HOME="$HOME"
    SUDO="sudo"
    as_user() { "$@"; }
fi

echo "==> Bersihkan Claude Buddy lama (kalau ada)"
as_user gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
as_user rm -rf "$TARGET_HOME/.local/share/gnome-shell/extensions/$OLD_UUID" \
    "$TARGET_HOME/.local/share/applications/io.claude.buddy.desktop" \
    "$TARGET_HOME/.local/share/icons/hicolor/scalable/apps/claude-buddy.svg"
if [ -e /etc/systemd/system/claude-buddy-status.timer ]; then
    $SUDO systemctl disable --now claude-buddy-status.timer 2>/dev/null || true
fi
$SUDO rm -rf /usr/local/bin/claude-buddy-launch /usr/local/bin/claude-buddy-status \
    /usr/local/bin/claude-buddy-switch /usr/local/bin/claude-sudo \
    /usr/local/lib/claude-buddy /run/claude-buddy \
    /etc/systemd/system/claude-buddy-status.service /etc/systemd/system/claude-buddy-status.timer \
    /etc/polkit-1/rules.d/49-claude-buddy-status.rules
# Posisi maskot lama dibawa ke file baru
if [ -e "$TARGET_HOME/.config/claude-buddy.json" ] && [ ! -e "$TARGET_HOME/.config/teman-ngoding.json" ]; then
    as_user cp "$TARGET_HOME/.config/claude-buddy.json" "$TARGET_HOME/.config/teman-ngoding.json"
fi

echo "==> File user"
EXT_DIR="$TARGET_HOME/.local/share/gnome-shell/extensions/$UUID"
as_user mkdir -p "$EXT_DIR" "$TARGET_HOME/.local/share/applications" \
    "$TARGET_HOME/.local/share/icons/hicolor/scalable/apps"
as_user cp extension/"$UUID"/* "$EXT_DIR/"
as_user cp desktop/teman-ngoding.desktop "$TARGET_HOME/.local/share/applications/"
as_user cp icons/teman-ngoding.svg "$TARGET_HOME/.local/share/icons/hicolor/scalable/apps/"
as_user gtk-update-icon-cache -q -t "$TARGET_HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "==> File sistem (${SUDO:-root})"
$SUDO install -m 755 bin/teman-ngoding-launch bin/teman-ngoding-switch bin/teman-ngoding-run /usr/local/bin/
# Script status & polkit menyebut nama user; sesuaikan dengan user yang memasang
sed "s|('yandi', '/home/yandi')|('$TARGET_USER', '$TARGET_HOME')|" bin/teman-ngoding-status \
    | $SUDO install -m 755 /dev/stdin /usr/local/bin/teman-ngoding-status
$SUDO install -d -m 755 /usr/local/lib/teman-ngoding/bin
sed "s|:-yandi}|:-$TARGET_USER}|" lib/open-in-user-chrome \
    | $SUDO install -m 755 /dev/stdin /usr/local/lib/teman-ngoding/open-in-user-chrome
for name in sensible-browser www-browser x-www-browser xdg-open; do
    $SUDO ln -sf ../open-in-user-chrome "/usr/local/lib/teman-ngoding/bin/$name"
done
$SUDO install -m 644 systemd/teman-ngoding-status.service systemd/teman-ngoding-status.timer /etc/systemd/system/
sed "s|subject.user == \"yandi\"|subject.user == \"$TARGET_USER\"|" polkit/49-teman-ngoding-status.rules \
    | $SUDO install -m 644 /dev/stdin /etc/polkit-1/rules.d/49-teman-ngoding-status.rules

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now teman-ngoding-status.timer
$SUDO systemctl start teman-ngoding-status.service || true

echo "==> Aktifkan ekstensi"
as_user gnome-extensions enable "$UUID" 2>/dev/null \
    || echo "   Logout/login dulu, lalu: gnome-extensions enable $UUID"

echo "Selesai! Teman Ngoding siap 🤝"
