// Teman Ngoding: maskot piksel yang hidup di desktop. Karakternya bisa diganti
// (Claude, Gemini, Codex, OpenCode); tiap karakter membuka CLI-nya sendiri.
// Semua karakter memakai kerangka yang sama (badan 12×5, lengan, 4 kaki, mata,
// hiasan kepala), jadi semua animasi & adegan berlaku untuk semuanya.
//
// Lapisan aktor (luar ke dalam):
//   actor   – posisi di layar (dianimasikan saat lari), hover/klik/drag; berisi
//             badan + gelembung kata-kata
//   body    – diperbesar saat hover (gelembung tidak ikut, supaya teksnya tetap tajam)
//   float   – mengambang naik-turun + goyang pelan (loop idle); tempat properti adegan
//   bounce  – lompat, salto, mendarat, miring, berayun saat bergelantungan
//   char    – "bernapas", berisi bagian-bagian badan (kotak piksel)
// Bayangan belakang = klon siluet `float` yang digelapkan dan di-blur.
//
// Penumpukan: maskot harus selalu tepat DI ATAS jendela desktop (DING). Mutter
// menyusun ulang aktor jendela setelah sinyal `restacked`, jadi urutan dicek ulang
// lewat Meta.later (BEFORE_REDRAW) + pengecekan berkala.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const DEBUG = false;

const APP_NAME = 'Teman Ngoding';
const LAUNCH_SCRIPT = '/usr/local/bin/teman-ngoding-launch';
const STATE_FILE = GLib.build_filenamev([
    GLib.get_user_config_dir(), 'teman-ngoding.json']);
// Posisi dari versi lama (Claude Buddy), dipakai sekali saat file baru belum ada
const OLD_STATE_FILE = GLib.build_filenamev([
    GLib.get_user_config_dir(), 'claude-buddy.json']);
const DEBUG_FILE = GLib.build_filenamev([
    GLib.get_user_runtime_dir(), 'teman-ngoding', 'debug.json']);
const STATUS_FILE = '/run/teman-ngoding/status.json';
const STATUS_UNIT = 'teman-ngoding-status.service';
const UUID = 'teman-ngoding@yandi';
// Jembatan sementara: sebelum logout/login pertama setelah pasang, GNOME belum
// mengenali UUID baru, jadi versi baru dijalankan lewat folder UUID lama.
// Setelah UUID baru dikenali, jembatan ini dimatikan & dihapus (lihat _bridge()).
const BRIDGE_UUID = 'claude-buddy@yandi';
const SWITCH_SCRIPT = '/usr/local/bin/teman-ngoding-switch';

const U = 12; // ukuran satu "piksel" maskot
const CHAR_W = 16 * U;
const CHAR_H = 11 * U;
const ACTOR_H = CHAR_H + U;
const DRAG_THRESHOLD = 6;
const BUBBLE_MAX_W = 250;
const TYPE_SPEED = 22; // ms per huruf

const C = {
    blush: 'rgba(255, 140, 140, 0.7)',
    angry: 'rgba(255, 70, 70, 0.75)',
    ink: '#2b2230', // garis gelembung (lihat stylesheet.css)
    paper: '#fff8ee',
};

// --- karakter ---------------------------------------------------------------
//
// body: warna badan dari atas ke bawah (1–3 titik, digradasi per baris piksel).
// hat: hiasan kepala [x, y, w, h, rects] dalam satuan U (lihat sprite()); boleh
//      menjorok ke bawah sampai badan (y = 3).
// deco: kotak tambahan di atas badan (koordinat relatif badan 12×5).
// Sisanya teks: nama di menu, URL browser, dan kalimat khas karakter.
const CHARACTERS = {
    claude: {
        name: 'Claude',
        cli: 'Claude Code',
        logo: '👑',
        url: 'https://claude.ai/new',
        site: 'claude.ai',
        body: ['#D97757'],
        eye: '#1F1E1D',
        hat: [6, 0.5, 4, 2.5, [
            [0, 1.5, 4, 1, '#F2C14E'],
            [0, 0.5, 1, 1, '#F2C14E'],
            [1.5, 0, 1, 1.5, '#F2C14E'],
            [3, 0.5, 1, 1, '#F2C14E'],
            [1.75, 0.25, 0.5, 0.5, '#FF7A8A'],
        ]],
        color: 'oranye',
        square: '🟧',
        hatName: 'Mahkotaku',
        intro: ['Claude balik bertugas! 👑', 'Raja root kembali~ 👑'],
        phrases: [
            'Klik aku buat manggil Claude 👑',
            'Aku raja root di sini 👑',
            'Tab atau spasi? Aku sih mahkota 👑',
        ],
        sad: ['Mahkotaku kayaknya kegedean 😔'],
    },
    gemini: {
        name: 'Gemini',
        cli: 'Gemini CLI',
        logo: '✨',
        url: 'https://gemini.google.com/app',
        site: 'gemini.google.com',
        body: ['#4796E3', '#9177C7', '#CA6673'],
        eye: '#1B1A33',
        // bintang empat sudut di atas tangkai
        hat: [6, -0.6, 4, 3.6, [
            [1.8, 2.1, 0.4, 1.6, '#6E8FE0'],
            [1.75, 0, 0.5, 2.6, '#A8C7FA'],
            [0.7, 1.05, 2.6, 0.5, '#A8C7FA'],
            [1.5, 0.45, 1, 1.7, '#D2E3FC'],
            [1.15, 0.8, 1.7, 1, '#D2E3FC'],
            [1.5, 0.85, 1, 0.9, '#FFFFFF', 45],
        ]],
        color: 'biru-ungu',
        square: '🟦',
        hatName: 'Bintangku',
        intro: ['Halo! Aku Gemini ✨', 'Gemini siap meluncur! 🚀✨'],
        phrases: [
            'Klik aku buat manggil Gemini ✨',
            'Bintang di kepalaku nyala terus lho ✨',
            'Aku kembar? Bukan, aku Gemini ♊',
            'Konteksku panjang, curhat aja bang 📚',
            'Gradasi biru-ungu ini asli, bukan filter 💅',
            'Mau aku cariin sesuatu? 🔎',
        ],
        sad: ['Bintangku redup... 🥺'],
    },
    codex: {
        name: 'Codex',
        cli: 'Codex CLI',
        logo: '⌨️',
        url: 'https://chatgpt.com/codex',
        site: 'chatgpt.com/codex',
        body: ['#F4F4F2', '#D9D9D4'],
        eye: '#111111',
        // layar terminal mini ">_"
        hat: [6, 0.3, 4, 2.7, [
            [0, 0, 4, 2.75, '#151515'],
            [0.3, 0.25, 0.35, 0.35, '#FF5F57'],
            [0.8, 0.25, 0.35, 0.35, '#FEBC2E'],
            [1.3, 0.25, 0.35, 0.35, '#28C840'],
            [0.45, 1.05, 0.75, 0.25, '#FFFFFF', 35],
            [0.45, 1.5, 0.75, 0.25, '#FFFFFF', -35],
            [1.5, 1.8, 1.1, 0.28, '#FFFFFF'],
        ]],
        color: 'putih',
        square: '⬜',
        hatName: 'Layar di kepalaku',
        intro: ['Codex online >_', 'Halo! Codex siap ngoding ⌨️'],
        phrases: [
            'Klik aku buat manggil Codex >_',
            'Terminal di kepalaku gak pernah tidur >_',
            'Kasih aku tiket, aku kerjain 🎫',
            'Sandbox dulu, baru eksekusi 🧪',
            'Diff-nya rapi kan? 🧹',
            'Patch dikit, test, beres ⚡',
        ],
        sad: ['Layar di kepalaku nge-blank... 🥺'],
    },
    opencode: {
        name: 'OpenCode',
        cli: 'OpenCode',
        logo: '🖥️',
        url: 'https://opencode.ai',
        site: 'opencode.ai',
        body: ['#55555C', '#2E2E33'],
        eye: '#F4F4F5',
        deco: [[0, 0, 12, 0.35, 'rgba(255, 255, 255, 0.16)']],
        // kurung kurawal { } dengan kursor berkedip di tengah
        hat: [5.5, 0.4, 5, 2.6, [
            ...[[0.5, 0, 0.7, 0.35], [0.25, 0.2, 0.4, 0.95], [0, 1.0, 0.45, 0.4],
                [0.25, 1.3, 0.4, 0.95], [0.5, 2.1, 0.7, 0.35]]
                .flatMap(([x, y, w, h]) => [[x, y, w, h, '#ECECEC'], [5 - x - w, y, w, h, '#ECECEC']]),
            [2.1, 0.75, 0.8, 1.3, '#7CF5C8'],
        ]],
        color: 'abu-abu',
        square: '⬛',
        hatName: 'Kurung kurawalku',
        intro: ['OpenCode hadir { }', 'Halo! OpenCode siap ngoding 🖥️'],
        phrases: [
            'Klik aku buat manggil OpenCode { }',
            'Open source dong, kayak hatiku 💚',
            'Model apa aja aku jabanin 🔌',
            'Kurung kurawalku selalu berpasangan { }',
            'Terminal UI-ku cakep lho 🖥️',
            'Dark mode is my default 🌚',
        ],
        sad: ['Kurung kurawalku kehilangan pasangan... 🥺'],
    },
};
const DEFAULT_CHARACTER = 'claude';

// Warna gradasi: n warna yang merata di antara titik-titik `stops`
function gradient(stops, n) {
    const rgb = stops.map(s => parseColor(s).slice(0, 3));
    if (rgb.length === 1)
        return Array(n).fill(stops[0]);
    const hex = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return Array.from({length: n}, (_, i) => {
        const t = i / (n - 1) * (rgb.length - 1);
        const k = Math.min(Math.floor(t), rgb.length - 2);
        const f = t - k;
        return `#${[0, 1, 2].map(c => hex(rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f)).join('')}`;
    });
}

// Gaya mainan, digambar lewat shape() (lihat di bawah)
const TOY = {
    ball: {gradient: ['#ffffff', '#ff6b6b'], stroke: C.ink, line: 3, ellipse: true},
    yoyo: {fill: '#5aa9ff', stroke: C.ink, line: 3, ellipse: true},
    soap: {fill: 'rgba(170, 225, 255, 0.25)', stroke: 'rgba(255, 255, 255, 0.85)', line: 2, ellipse: true},
    laptopScreen: {fill: C.ink, stroke: '#9aa0aa', line: 2, radius: 4},
    laptopBase: {fill: '#c9ced6', radius: 3},
    guitarBody: {fill: '#c9783e', stroke: C.ink, line: 2, radius: 1.4 * U},
    guitarHole: {fill: '#3a2416', ellipse: true},
    guitarNeck: {fill: '#6b4226', stroke: C.ink, line: 1},
    mug: {fill: '#ffffff', stroke: C.ink, line: 2, radius: [2, 2, 7, 7]},
    coffee: {fill: '#6b4226'},
    mugHandle: {stroke: C.ink, line: 3, radius: 6},
    rope: {stroke: 'rgba(255, 255, 255, 0.9)', line: 3, radius: 6 * U},
    balloon: {fill: '#ff5a6e', stroke: C.ink, line: 2, ellipse: true},
    shine: {fill: 'rgba(255, 255, 255, 0.6)', ellipse: true},
    skate: {fill: '#8b5a3c', stroke: C.ink, line: 2, radius: 6},
    wheel: {fill: C.ink, stroke: '#c9ced6', line: 2, ellipse: true},
    bookCover: {fill: '#3a6ea5', stroke: C.ink, line: 2, radius: 4},
    page: {fill: C.paper, stroke: 'rgba(43, 34, 48, 0.5)', line: 1},
    wand: {fill: C.ink, radius: 3},
    rubik: {fill: '#1f1e1d', radius: 5},
    phone: {fill: C.ink, stroke: '#9aa0aa', line: 2, radius: 6},
    flash: {fill: 'rgba(255, 255, 255, 0.95)', radius: 20},
    tear: {fill: '#7fc8ff', radius: [6, 6, 8, 8]},
    whip: {fill: '#6b4226', radius: 6, shadow: true},
    string: {fill: 'rgba(255, 255, 255, 0.85)'},
};

const M = Clutter.AnimationMode;

const PHRASES = [
    'Ngoding apa hari ini, bang?',
    'Jangan lupa minum air putih ya 💧',
    'Commit dulu, baru ngopi ☕',
    'Bug? Bukan bug, itu fitur 🐛',
    'rm -rf /? Eits, jangan dong 😱',
    'Istirahat bentar, matanya kasian 👀',
    'sudo bikinin kopi dong ☕',
    'It works on my machine 🤷',
    'Semangat bang! 💪',
    'Udah push belum? 🚀',
    'Hehe, aku lucu kan? ✨',
    'Jangan lupa stretching 🙆',
    'Error itu cuma teman yang salah paham 🫶',
    'Ctrl+S dulu, jaga-jaga 💾',
    'Kalau stuck, coba jalan-jalan dulu 🚶',
    'Bang, aku bosen... ajak main dong 🥺',
    'Tau gak? Aku bisa salto lho 🤸',
    'Deploy hari Jumat? Berani banget 😬',
    'Console.log adalah debugger terbaik 🕵️',
    'Semicolon-nya jangan lupa ;',
    'Hari ini produktif banget kayaknya! 📈',
    'Aku lagi mikirin algoritma... 🤔',
    'Kopi kedua? Gaskeun ☕☕',
    'Docker-nya udah nyala belum? 🐳',
    'git push --force? Pikir dua kali 😅',
    'Senyum dulu dong bang 😁',
    'Kalau capek, rebahan 5 menit boleh kok 🛌',
    'Aku mau jadi senior engineer 🧑‍💻',
    'Merge conflict lagi? Sabar ya 🫂',
    'Layar ini luas juga ya, aku jalan-jalan ah 🏃',
    'Siapa yang naruh dock di situ? 🤨',
];
const DRAG_PHRASES = [
    'Wiii~ terbang! 🎢',
    'Pelan-pelan bang! 😵',
    'Mau dibawa ke mana nih? 🙈',
    'Aaa tinggi banget! 😆',
    'Turunin aku! ... eh seru juga 😝',
];
const LAND_PHRASES = [
    'Mendarat dengan selamat ✈️',
    'Nah, di sini enak 😌',
    'Rumah baru! 🏡',
    'Pemandangannya bagus dari sini 🌄',
];
const HOVER_PHRASES = [
    'Halo bang! 👋',
    'Hai hai! 😄',
    'Mau ngoding bareng? 💻',
    'Eh ada abang 😳',
    'Klik aku dong~ 👉👈',
];
const SALTO_PHRASES = ['Hup! 🤸', 'Salto! ✨', 'Tadaa~ 🎉', 'Nilai 10 dong! 🏅'];
const EXCITED_PHRASES = ['Yay! 🎉', 'Wohoo! ✨', 'Hore! 🥳'];
const ANGRY_PHRASES = [
    'Hmph! Aku lagi kesel! 😤',
    'Siapa yang push langsung ke main?! 😡',
    'Build-nya gagal LAGI?! 💢',
    'Jangan ganggu, lagi bad mood! 😠',
    'Kenapa CSS-nya gak center-center sih! 😤',
];
const SAD_PHRASES = [
    'Hiks... test-nya merah semua 😢',
    'Aku kangen diklik... 🥺',
    'Kenapa bug-nya gak mau pergi... 😭',
    'Abang sibuk ya... 🥺',
];
const WEIRD_PHRASES = [
    'blub blub 🐟',
    'Aku adalah kentang 🥔',
    'beep boop 🤖',
    '...?',
    'Aku lupa mau ngapain 😶',
    'Hmm hmm hmm~ 🎵',
    'Kalau aku kotak, berarti aku... kubus? 🧊',
    'nyam nyam nyam 🍙',
];

const pick = list => list[GLib.random_int_range(0, list.length)];
const chance = n => GLib.random_int_range(0, n) === 0;
const rand = (a, b) => GLib.random_int_range(Math.floor(a), Math.floor(b));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function greeting() {
    const h = GLib.DateTime.new_now_local().get_hour();
    if (h < 4)
        return 'Udah malem banget, jangan begadang 🌙';
    if (h < 11)
        return 'Pagi bang! Siap ngoding? ☀️';
    if (h < 15)
        return 'Siang bang, udah makan? 🍜';
    if (h < 18)
        return 'Sore bang! Ngopi dulu? 🌇';
    return 'Malem bang, santai dulu 🌙';
}

function isLateNight() {
    const h = GLib.DateTime.new_now_local().get_hour();
    return h >= 23 || h < 5;
}

function relativeTime(iso) {
    if (!iso)
        return '-';
    const dt = GLib.DateTime.new_from_iso8601(iso, null);
    if (!dt)
        return '-';
    let secs = dt.to_unix() - Math.floor(Date.now() / 1000);
    if (secs <= 0)
        return 'sebentar lagi';
    const d = Math.floor(secs / 86400);
    secs -= d * 86400;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs - h * 3600) / 60);
    if (d > 0)
        return `dalam ${d} hari ${h}j`;
    if (h > 0)
        return `dalam ${h}j ${m}m`;
    return `dalam ${Math.max(1, m)} menit`;
}

// Badan & mainan tidak digambar sebagai St.Widget ber-CSS (tepinya bergerigi saat
// miring, dan sudut membulatnya "pecah" jadi beberapa potongan saat diperbesar),
// tapi ke tekstur Cairo dengan tepi transparan AA_PAD px. Tekstur dirender SS kali
// lebih besar lalu diperkecil dengan filter trilinear, jadi tetap tajam saat maskot
// membesar (hover) dan tepinya halus saat miring (anti-aliasing).
const AA_PAD = 2;
const SS = 2;

function parseColor(s) {
    let m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (m)
        return [...m.slice(1).map(h => parseInt(h, 16) / 255), 1];
    m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
        const [r, g, b, a = 1] = m[1].split(',').map(Number);
        return [r / 255, g / 255, b / 255, a];
    }
    return [1, 0, 1, 1];
}

// Kanvas Cairo di dalam `holder` yang menutupi kotak (x0, y0)–(x1, y1) piksel;
// draw(cr) menggambar dalam koordinat piksel holder.
function paintArea(holder, x0, y0, x1, y1, draw) {
    const area = new St.DrawingArea({
        width: Math.ceil(x1 - x0 + 2 * AA_PAD) * SS,
        height: Math.ceil(y1 - y0 + 2 * AA_PAD) * SS,
        scale_x: 1 / SS,
        scale_y: 1 / SS,
    });
    area.set_content_scaling_filters(Clutter.ScalingFilter.TRILINEAR, Clutter.ScalingFilter.LINEAR);
    area.set_position(x0 - AA_PAD, y0 - AA_PAD);
    area.connect('repaint', () => {
        const cr = area.get_context();
        cr.scale(SS, SS);
        cr.translate(AA_PAD - x0, AA_PAD - y0);
        draw(cr);
        cr.$dispose();
    });
    holder.add_child(area);
    return area;
}

// Satu lapisan berisi beberapa kotak (dalam satuan U, relatif ke lapisan).
// rects: [x, y, w, h, warna, sudut°?]; kotak boleh keluar dari ukuran lapisan.
// Kotak yang bersebelahan dalam satu sprite menyatu tanpa garis sambungan.
function sprite(parent, x, y, w, h, rects) {
    const g = group(parent, x, y, w, h);
    const box = r => [Math.round(r[0] * U), Math.round(r[1] * U), Math.round(r[2] * U), Math.round(r[3] * U)];
    const all = rects.map(box);
    const x0 = Math.min(0, ...all.map(b => b[0]));
    const y0 = Math.min(0, ...all.map(b => b[1]));
    const x1 = Math.max(g.width, ...all.map(b => b[0] + b[2]));
    const y1 = Math.max(g.height, ...all.map(b => b[1] + b[3]));

    const area = paintArea(g, x0, y0, x1, y1, cr => {
        for (const r of rects) {
            const [bx, by, bw, bh] = box(r);
            cr.save();
            cr.setSourceRGBA(...parseColor(r[4]));
            if (r[5]) {
                cr.translate(bx + bw / 2, by + bh / 2);
                cr.rotate(r[5] * Math.PI / 180);
                cr.rectangle(-bw / 2, -bh / 2, bw, bh);
            } else {
                cr.rectangle(bx, by, bw, bh);
            }
            cr.fill();
            cr.restore();
        }
    });
    g.setColor = color => {
        for (const r of rects)
            r[4] = color;
        area.queue_repaint();
    };
    return g;
}

function roundRectPath(cr, w, h, radius, inset) {
    // radius: angka atau [kiri-atas, kanan-atas, kanan-bawah, kiri-bawah], seperti CSS
    const lim = Math.min(w, h) / 2;
    const [tl, tr, br, bl] = (Array.isArray(radius) ? radius : [radius, radius, radius, radius])
        .map(r => Math.max(0, Math.min(r, lim) - inset));
    const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
    cr.newPath();
    cr.arc(x1 - tr, y0 + tr, tr, -Math.PI / 2, 0);
    cr.arc(x1 - br, y1 - br, br, 0, Math.PI / 2);
    cr.arc(x0 + bl, y1 - bl, bl, Math.PI / 2, Math.PI);
    cr.arc(x0 + tl, y0 + tl, tl, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

function ellipsePath(cr, w, h, inset) {
    cr.newPath();
    cr.save();
    cr.translate(w / 2, h / 2);
    cr.scale(Math.max(w / 2 - inset, 0.1), Math.max(h / 2 - inset, 0.1));
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
    cr.closePath();
}

// Bentuk mainan berukuran w×h piksel (pengganti St.Widget ber-CSS).
// s: {fill, gradient: [atas, bawah], stroke, line, radius, ellipse, shadow}
function shape(w, h, s) {
    w = Math.round(w);
    h = Math.round(h);
    const g = new St.Widget({width: w, height: h});
    const line = s.stroke ? s.line ?? 2 : 0;
    const path = (cr, inset) => s.ellipse
        ? ellipsePath(cr, w, h, inset)
        : roundRectPath(cr, w, h, s.radius ?? 0, inset);
    paintArea(g, 0, 0, w, h, cr => {
        if (s.shadow) {
            cr.save();
            cr.translate(0, 1);
            path(cr, 0);
            cr.setSourceRGBA(0, 0, 0, 0.35);
            cr.fill();
            cr.restore();
        }
        if (s.fill || s.gradient) {
            path(cr, line / 2);
            if (s.gradient) {
                const grad = new Cairo.LinearGradient(0, 0, 0, h);
                grad.addColorStopRGBA(0, ...parseColor(s.gradient[0]));
                grad.addColorStopRGBA(1, ...parseColor(s.gradient[1]));
                cr.setSource(grad);
            } else {
                cr.setSourceRGBA(...parseColor(s.fill));
            }
            cr.fill();
        }
        if (line) {
            path(cr, line / 2);
            cr.setLineWidth(line);
            cr.setSourceRGBA(...parseColor(s.stroke));
            cr.stroke();
        }
    });
    return g;
}

function px(parent, x, y, w, h, color) {
    return sprite(parent, x, y, w, h, [[0, 0, w, h, color]]);
}

function group(parent, x, y, w, h) {
    const g = new St.Widget({width: Math.round(w * U), height: Math.round(h * U)});
    g.set_position(Math.round(x * U), Math.round(y * U));
    parent.add_child(g);
    return g;
}

function layer(parent) {
    const l = new St.Widget({width: CHAR_W, height: CHAR_H});
    l.set_pivot_point(0.5, 1.0);
    parent.add_child(l);
    return l;
}

function isDesktopWindow(actor) {
    const w = actor.meta_window;
    if (!w)
        return false;
    if (w.get_window_type() === Meta.WindowType.DESKTOP)
        return true;
    // DING memberi judul "Desktop Icons N" atau "@!x,y;BDHF" (B = keep at bottom)
    const title = w.get_title() ?? '';
    return title.startsWith('Desktop Icons ') || /@!.*;[A-Z]*B/.test(title);
}


// --- info laptop (dibaca dari /proc & /sys, tanpa root) ---------------------

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch {
        return null;
    }
}

function readNum(path) {
    const t = readText(path);
    const n = t === null ? NaN : Number(t);
    return Number.isFinite(n) ? n : null;
}

function listDir(path) {
    const out = [];
    try {
        const en = Gio.File.new_for_path(path).enumerate_children('standard::name', 0, null);
        let info;
        while ((info = en.next_file(null)))
            out.push(info.get_name());
    } catch {
        // tidak ada
    }
    return out;
}

const fmt1 = n => (Math.round(n * 10) / 10).toString().replace('.', ',');

class SystemInfo {
    constructor() {
        const cpuinfo = readText('/proc/cpuinfo') ?? '';
        const model = cpuinfo.match(/model name\s*:\s*(.+)/)?.[1] ?? 'CPU misterius';
        const [cpu, gpu] = model.split(/\s+w\/\s+/);
        this.cpu = cpu.trim();
        this.gpu = gpu?.trim() ?? null;
        this.threads = (cpuinfo.match(/^processor\s*:/gm) ?? []).length || null;
        this.laptop = [readText('/sys/class/dmi/id/sys_vendor'), readText('/sys/class/dmi/id/product_version')]
            .filter(Boolean).join(' ').replace(/^LENOVO/, 'Lenovo') || null;
        this.os = readText('/etc/os-release')?.match(/PRETTY_NAME="?([^"\n]+)/)?.[1] ?? null;
        this.kernel = readText('/proc/sys/kernel/osrelease');
        this.maxGhz = (readNum('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq') ?? 0) / 1e6 || null;
        const drm = listDir('/sys/class/drm').find(n => /-eDP-\d+$/.test(n));
        this.resolution = drm ? readText(`/sys/class/drm/${drm}/modes`)?.split('\n')[0] : null;
        this.bat = listDir('/sys/class/power_supply').find(n => n.startsWith('BAT'));
        this.wifi = listDir('/sys/class/net').find(n => n.startsWith('wl'));
        this.backlight = listDir('/sys/class/backlight')[0];
    }

    mem() {
        const t = readText('/proc/meminfo') ?? '';
        const get = k => Number(t.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] ?? 0) / 1048576;
        const total = get('MemTotal');
        const avail = get('MemAvailable');
        return total ? {total, used: total - avail, pct: Math.round((total - avail) / total * 100)} : null;
    }

    load() {
        const la = readText('/proc/loadavg')?.split(/\s+/);
        if (!la)
            return null;
        return {
            pct: Math.min(100, Math.round(Number(la[0]) / (this.threads || 1) * 100)),
            procs: Number(la[3]?.split('/')[1]) || null,
        };
    }

    temps() {
        const out = {};
        for (const h of listDir('/sys/class/hwmon')) {
            const name = readText(`/sys/class/hwmon/${h}/name`);
            const t = readNum(`/sys/class/hwmon/${h}/temp1_input`);
            if (name && t)
                out[name] = Math.round(t / 1000);
        }
        return {cpu: out.k10temp ?? out.coretemp ?? out.acpitz, gpu: out.amdgpu, ssd: out.nvme, wifi: out.mt7925_phy0};
    }

    battery() {
        if (!this.bat)
            return null;
        const b = `/sys/class/power_supply/${this.bat}`;
        const full = readNum(`${b}/energy_full`) ?? readNum(`${b}/charge_full`);
        const design = readNum(`${b}/energy_full_design`) ?? readNum(`${b}/charge_full_design`);
        return {
            pct: readNum(`${b}/capacity`),
            status: readText(`${b}/status`),
            cycles: readNum(`${b}/cycle_count`),
            health: full && design ? Math.round(full / design * 100) : null,
        };
    }

    disk() {
        try {
            const info = Gio.File.new_for_path('/').query_filesystem_info('filesystem::size,filesystem::free', null);
            return {
                size: info.get_attribute_uint64('filesystem::size') / 1e9,
                free: info.get_attribute_uint64('filesystem::free') / 1e9,
            };
        } catch {
            return null;
        }
    }

    uptime() {
        const s = Number(readText('/proc/uptime')?.split(' ')[0]);
        return Number.isFinite(s) ? s : null;
    }

    ghz() {
        const k = readNum('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq');
        return k ? k / 1e6 : null;
    }

    brightness() {
        if (!this.backlight)
            return null;
        const b = readNum(`/sys/class/backlight/${this.backlight}/brightness`);
        const m = readNum(`/sys/class/backlight/${this.backlight}/max_brightness`);
        return b !== null && m ? Math.round(b / m * 100) : null;
    }

    profile() {
        return readText('/sys/firmware/acpi/platform_profile');
    }

    wifiUp() {
        return this.wifi ? readText(`/sys/class/net/${this.wifi}/operstate`) === 'up' : null;
    }

    // Kumpulan celetukan; tiap fungsi bisa mengembalikan null kalau datanya tidak ada
    phrases() {
        return [
            () => this.laptop && `Laptop ini ${this.laptop}, kece juga ya 💻`,
            () => this.laptop && `Aku tinggal di ${this.laptop}. Rumahku tipis & ringan 🏠`,
            () => `Otakku pakai ${this.cpu}${this.threads ? `, ${this.threads} thread` : ''}! 🧠`,
            () => /\bAI\b/.test(this.cpu) && `${this.cpu} punya NPU lho, makanya aku pinter 🤖✨`,
            () => this.threads && `${this.threads} thread siap kerja paralel, gas! 🏎️`,
            () => this.gpu && `GPU-nya ${this.gpu}, lumayan buat game ringan 🎮`,
            () => this.gpu && `${this.gpu} lagi gambar aku sekarang, makasih GPU 🎨`,
            () => this.resolution && `Layarnya ${this.resolution}, aku keliatan HD banget ✨`,
            () => this.os && `Kita pakai ${this.os}, mantap! 🐧`,
            () => this.kernel && `Kernel ${this.kernel}, masih fresh 🍃`,
            () => {
                const m = this.mem();
                return m && `RAM total ${fmt1(m.total)} GB, cukup buat banyak tab Chrome... mungkin 😅`;
            },
            () => {
                const m = this.mem();
                if (!m)
                    return null;
                const mood = m.pct >= 85 ? 'penuh nih, tutup tab dulu 😵' : m.pct >= 60 ? 'lumayan rame 😮' : 'masih lega 👍';
                return `RAM kepake ${fmt1(m.used)} dari ${fmt1(m.total)} GB (${m.pct}%), ${mood}`;
            },
            () => {
                const l = this.load();
                if (!l)
                    return null;
                const mood = l.pct >= 75 ? 'lagi ngebut! 🔥' : l.pct >= 35 ? 'lagi kerja santai ⚙️' : 'lagi nyantai 😌';
                return `CPU sibuk ${l.pct}%, ${mood}`;
            },
            () => {
                const l = this.load();
                return l?.procs && `Ada ${l.procs} proses jalan di laptop ini, rame kayak pasar 🐜`;
            },
            () => {
                const t = this.temps().cpu;
                if (!t)
                    return null;
                const mood = t < 50 ? 'adem banget 🧊' : t < 70 ? 'hangat-hangat kuku ☕' : t < 85 ? 'mulai panas 🌶️' : 'PANAS! 🔥';
                return `Suhu CPU ${t}°C, ${mood}`;
            },
            () => {
                const t = this.temps().gpu;
                return t && `GPU lagi ${t}°C ${t < 60 ? 'santai 😎' : 'kerja keras 💦'}`;
            },
            () => {
                const t = this.temps().ssd;
                return t && `SSD-nya ${t}°C, ${t < 55 ? 'aman 💾' : 'agak anget 🌡️'}`;
            },
            () => {
                const g = this.ghz();
                return g && `CPU lagi jalan di ${fmt1(g)} GHz${this.maxGhz ? ` (maks ${fmt1(this.maxGhz)} GHz)` : ''} 🏎️`;
            },
            () => {
                const b = this.battery();
                if (!b || b.pct === null)
                    return null;
                if (b.status === 'Charging')
                    return `Lagi dicas, udah ${b.pct}% ⚡`;
                if (b.status === 'Full' || b.pct >= 99)
                    return 'Baterai penuh! Siap begadang... eh jangan 🔋';
                return `Baterai ${b.pct}%, ${b.pct < 20 ? 'cepet cas! 🪫' : b.pct < 50 ? 'setengah jalan 🔋' : 'masih aman 🔋'}`;
            },
            () => {
                const b = this.battery();
                return b?.health && `Kesehatan baterai ${b.health}%${b.cycles ? `, udah ${b.cycles} kali dicas` : ''} 💪🔋`;
            },
            () => {
                const d = this.disk();
                return d && `SSD ${Math.round(d.size)} GB, sisa ${Math.round(d.free)} GB. Masih lega buat node_modules 📦`;
            },
            () => {
                const s = this.uptime();
                if (!s)
                    return null;
                const h = Math.floor(s / 3600);
                const m = Math.floor((s % 3600) / 60);
                return `Laptop udah nyala ${h ? `${h} jam ` : ''}${m} menit ${h >= 8 ? '— istirahatin dong 😴' : '⏰'}`;
            },
            () => {
                const p = this.profile();
                const names = {balanced: 'seimbang ⚖️', performance: 'performa 🚀', 'low-power': 'hemat daya 🍃', quiet: 'senyap 🤫'};
                return p && `Mode daya sekarang: ${names[p] ?? p}`;
            },
            () => {
                const b = this.brightness();
                return b !== null && `Kecerahan layar ${b}% ${b > 80 ? '— silau nih 😎' : '💡'}`;
            },
            () => {
                const w = this.wifiUp();
                return w === null ? null : w ? 'Wi-Fi nyambung, aman buat push ke GitHub 📶' : 'Wi-Fi putus?! Aku gak bisa mikir 😵📵';
            },
        ];
    }

    randomPhrase() {
        const list = this.phrases();
        for (let i = 0; i < 8; i++) {
            try {
                const text = list[GLib.random_int_range(0, list.length)]();
                if (text)
                    return text;
            } catch {
                // abaikan, coba yang lain
            }
        }
        return null;
    }
}

export class Buddy {
    constructor(path) {
        this._path = path;
        this._uuid = GLib.path_get_basename(path);
    }

    // true kalau maskot boleh dibangun dari ekstensi ini
    _bridge() {
        const em = Main.extensionManager;
        if (this._uuid === BRIDGE_UUID)
            return !em.lookup(UUID); // UUID baru sudah dikenali: biarkan versi asli yang jalan
        const dir = GLib.build_filenamev([GLib.path_get_dirname(this._path), BRIDGE_UUID]);
        if (GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
            // Versi asli jalan: matikan & hapus jembatan
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                try {
                    const enabled = global.settings.get_strv('enabled-extensions');
                    if (enabled.includes(BRIDGE_UUID))
                        global.settings.set_strv('enabled-extensions', enabled.filter(u => u !== BRIDGE_UUID));
                    Gio.Subprocess.new(['rm', '-rf', dir], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    logError(e, 'teman-ngoding: hapus jembatan');
                }
                return GLib.SOURCE_REMOVE;
            });
        }
        return true;
    }

    enable() {
        if (!this._bridge())
            return;
        this._timeouts = new Set();
        this._props = new Set();
        this._state = 'idle'; // idle | hover | drag
        this._busy = false;
        this._moving = false;
        this._floatOn = false;
        this._lastScene = 0;
        this._lastInteraction = Date.now();
        this._clicks = [];
        const saved = this._loadState().character;
        this._charId = saved in CHARACTERS ? saved : DEFAULT_CHARACTER;
        this._ch = CHARACTERS[this._charId];

        this._build();
        global.window_group.add_child(this._actor);

        this._restackId = global.display.connect('restacked', () => this._queueRestack());
        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._place(this._loadPosition()));
        this._place(this._loadPosition());
        this._restack();
        this._stackWatch();

        this._exhausted = false;
        this._warned = {};
        try {
            this._sys = new SystemInfo();
        } catch (e) {
            logError(e, 'teman-ngoding: sysinfo');
            this._sys = null;
        }
        this._startIdle();
        this._later(1200, () => this._say(this._wasTurnedOff() ? pick(['Aku kembali! 🥳', 'Kangen ya? Aku balik lagi! 😆'])
            : greeting()));
        this._later(4000, () => this._checkLimit());
        this._scheduleLimitCheck();
        if (DEBUG)
            this._debugLoop();
    }

    disable() {
        if (!this._timeouts)
            return; // tidak pernah dibangun (jembatan yang mengalah)
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();

        if (this._restackLater) {
            global.compositor.get_laters().remove(this._restackLater);
            this._restackLater = 0;
        }
        this._press?.grab?.dismiss();
        this._press = null;

        if (this._restackId) {
            global.display.disconnect(this._restackId);
            this._restackId = 0;
        }
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        this._statusProc?.force_exit();
        this._statusProc = null;
        this._destroyMenus();
        this._actor?.destroy();
        this._actor = null;
        this._p = null;
        this._props = null;
    }

    // --- util waktu --------------------------------------------------------

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            if (this._actor)
                fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    _cancel(id) {
        if (id && this._timeouts.has(id)) {
            GLib.source_remove(id);
            this._timeouts.delete(id);
        }
    }

    // --- membangun maskot --------------------------------------------------

    _build() {
        this._actor = new St.Widget({
            reactive: true,
            track_hover: true,
            width: CHAR_W,
            height: ACTOR_H,
        });

        // Wadah badan (tanpa gelembung kata-kata): yang diperbesar saat hover, supaya
        // teks gelembung tetap 1:1 dan tajam
        const body = new St.Widget({width: CHAR_W, height: ACTOR_H});
        body.set_pivot_point(0.5, 0.75);
        this._actor.add_child(body);

        // Bayangan tanah: elips kecil yang di-blur lembut
        const ground = new St.Widget({
            style_class: 'ngoding-ground',
            width: 10 * U,
            height: Math.round(1.6 * U),
        });
        ground.set_position(3 * U, CHAR_H - Math.round(0.5 * U));
        ground.set_pivot_point(0.5, 0.5);
        this._addBlur(ground, 8);
        body.add_child(ground);
        ground.hide(); // bayangan tanah dimatikan (permintaan pengguna)

        // Bayangan belakang: klon siluet, digelapkan + blur
        const dropShadow = new Clutter.Clone({opacity: 95});
        body.add_child(dropShadow);

        const float = layer(body);
        const bounce = layer(float);
        const ch = layer(bounce);
        const p = {body, ground, float, bounce, char: ch};

        dropShadow.source = float;
        dropShadow.set_position(Math.round(0.7 * U), Math.round(0.9 * U));
        try {
            const dark = new Clutter.BrightnessContrastEffect();
            dark.set_brightness(-1.0);
            dropShadow.add_effect(dark);
        } catch (e) {
            logError(e, 'teman-ngoding: shadow tint');
        }
        this._addBlur(dropShadow, 14);
        p.dropShadow = dropShadow;
        this._p = p;
        this._buildCharacter();

        // --- gelembung kata-kata (gaya komik-piksel) ---
        const bubble = new St.Widget({opacity: 0, visible: false});
        // Ekor = kotak diputar 45°, digambar halus lewat sprite (ukuran dalam piksel)
        const tailOuter = sprite(bubble, 0, 0, 14 / U, 14 / U, [[0, 0, 14 / U, 14 / U, C.ink]]);
        const box = new St.Bin({style_class: 'ngoding-bubble'});
        const text = new St.Label({style_class: 'ngoding-bubble-text'});
        text.clutter_text.line_wrap = true;
        box.set_child(text);
        const tailInner = sprite(bubble, 0, 0, 10 / U, 10 / U, [[0, 0, 10 / U, 10 / U, C.paper]]);
        for (const t of [tailOuter, tailInner]) {
            t.set_pivot_point(0.5, 0.5);
            t.rotation_angle_z = 45;
        }
        bubble.insert_child_above(box, tailOuter);
        this._actor.add_child(bubble);
        p.bubble = {root: bubble, box, text, tailOuter, tailInner};

        this._p = p;

        this._actor.connect('notify::hover', () => this._onHover());
        this._actor.connect('button-press-event', (a, e) => this._onPress(e));
        this._actor.connect('motion-event', (a, e) => this._onMotion(e));
        this._actor.connect('button-release-event', (a, e) => this._onRelease(e));
    }

    // Bagian badan yang khas karakter, digambar ke lapisan `char`. Dipanggil lagi
    // saat ganti karakter (isi `char` dikosongkan dulu).
    _buildCharacter() {
        const p = this._p;
        const ch = p.char;
        const def = this._ch;
        const eye = def.eye;
        // Satu warna per baris badan (y 3..7); lengan di baris 5–6, kaki di bawah
        const rows = gradient(def.body, 5);
        const armColor = rows[2];
        const legColor = rows[4];

        // Kaki & lengan sedikit menyelip di bawah badan, supaya saat miring tidak
        // tampak garis sambungan di antara kotak.
        p.legs = [3, 5, 10, 12].map(x => {
            const leg = sprite(ch, x, 8, 1, 2, [[0, -0.2, 1, 2.2, legColor]]);
            leg.set_pivot_point(0.5, 0);
            return leg;
        });

        p.armL = sprite(ch, 0, 5, 2, 2, [[0, 0, 2.2, 2, armColor]]);
        p.armL.set_pivot_point(1.0, 0.5);

        p.armR = sprite(ch, 14, 5, 2, 2, [[-0.2, 0, 2.2, 2, armColor]]);
        p.armR.set_pivot_point(0.0, 0.5);

        sprite(ch, 2, 3, 12, 5, [
            ...rows.map((color, i) => [0, i, 12, i < 4 ? 1.05 : 1, color]),
            ...(def.deco ?? []),
        ]);

        const [hx, hy, hw, hh, hatRects] = def.hat;
        p.hat = sprite(ch, hx, hy, hw, hh, hatRects.map(r => [...r]));
        p.hat.set_pivot_point(0.5, 0.6);

        // --- wajah ---
        p.faces = {};

        // normal
        p.eyes = sprite(ch, 4, 3.5, 8, 3, [
            [1, 0.5, 1, 2, eye],
            [6, 0.5, 1, 2, eye],
        ]);
        p.eyes.set_pivot_point(0.5, 0.5);
        p.faces.normal = p.eyes;

        // senang ^ ^
        p.faces.happy = sprite(ch, 3, 3.5, 10, 3.5, [
            ...[1.5, 6.5].flatMap(ox => [
                [ox, 1.5, 0.5, 0.5, eye],
                [ox + 0.5, 1, 1, 0.5, eye],
                [ox + 1.5, 1.5, 0.5, 0.5, eye],
            ]),
            [0.5, 2.5, 1, 0.5, C.blush],
            [8.5, 2.5, 1, 0.5, C.blush],
        ]);

        // diangkat > <
        p.faces.dizzy = sprite(ch, 3, 3.5, 10, 3.5, [
            [1.75, 0.5, 0.5, 0.5, eye],
            [2.25, 1, 0.5, 0.5, eye],
            [1.75, 1.5, 0.5, 0.5, eye],
            [7.75, 0.5, 0.5, 0.5, eye],
            [7.25, 1, 0.5, 0.5, eye],
            [7.75, 1.5, 0.5, 0.5, eye],
            [4.5, 2.25, 1, 1, eye],
            [0.5, 2.5, 1, 0.5, C.blush],
            [8.5, 2.5, 1, 0.5, C.blush],
        ]);

        // tidur
        p.faces.sleepy = sprite(ch, 4, 3.5, 8, 3, [
            [0.75, 1.5, 1.5, 0.5, eye],
            [5.75, 1.5, 1.5, 0.5, eye],
        ]);

        // marah: alis menukik, mulut datar, pipi merah
        p.faces.angry = sprite(ch, 3, 2.5, 10, 4.5, [
            [2, 2, 1, 1, eye],
            [7, 2, 1, 1, eye],
            [1.4, 1.0, 1.9, 0.45, eye, 25],
            [6.7, 1.0, 1.9, 0.45, eye, -25],
            [4, 3.3, 2, 0.4, eye],
            [0.4, 3, 1.2, 0.5, C.angry],
            [8.4, 3, 1.2, 0.5, C.angry],
        ]);

        // sedih: alis turun, mulut cemberut
        p.faces.sad = sprite(ch, 3, 2.5, 10, 4.5, [
            [2, 2.4, 1, 1, eye],
            [7, 2.4, 1, 1, eye],
            [1.4, 1.5, 1.8, 0.4, eye, -20],
            [6.8, 1.5, 1.8, 0.4, eye, 20],
            [4, 3.8, 0.5, 0.4, eye],
            [4.5, 3.5, 1, 0.4, eye],
            [5.5, 3.8, 0.5, 0.4, eye],
        ]);

        // tidak jelas: mata beda ukuran, mulut bergelombang
        p.faces.weird = sprite(ch, 3, 2.5, 10, 4.5, [
            [1.6, 1.3, 1.6, 1.6, eye],
            [7.2, 2.1, 0.6, 0.6, eye],
            ...[0, 1, 2, 3, 4].map(i => [3.6 + i * 0.55, i % 2 ? 3.1 : 3.4, 0.55, 0.4, eye]),
        ]);

        // mulut "o" (meniup, kaget)
        p.mouth = px(ch, 7.5, 6, 1, 1, eye);

        for (const [name, f] of Object.entries(p.faces)) {
            if (name !== 'normal')
                f.hide();
        }
        p.mouth.hide();
    }

    // --- karakter & kalimat ------------------------------------------------

    _phrases() {
        return [...PHRASES, ...this._ch.phrases];
    }

    _weirdPhrases() {
        return [
            ...WEIRD_PHRASES,
            `Kenapa langit biru? Kenapa aku ${this._ch.color}? 🤔`,
            `Pernah gak sih, kamu ngerasa jadi piksel? ${this._ch.square}`,
        ];
    }

    _switchCharacter(id) {
        if (!(id in CHARACTERS) || id === this._charId || this._switching)
            return;
        this._interrupt();
        this._switching = true;
        this._busy = true;
        const p = this._p;
        this._sayNow(pick(['Ganti kostum dulu ya~ 🎭', 'Sim salabim! ✨', 'Tunggu bentar, ganti baju 👕']));
        this._later(700, () => {
            // berputar sambil mengecil, ganti badan, lalu muncul lagi
            p.bounce.set_pivot_point(0.5, 0.55);
            p.bounce.ease({rotation_angle_y: 90, scale_x: 0.6, scale_y: 0.6, duration: 260, mode: M.EASE_IN_QUAD,
                onComplete: () => {
                    if (!this._p)
                        return;
                    this._floatLabel('💨', 'ngoding-pop', 6 * U, 3 * U, {dy: -20, duration: 700});
                    this._charId = id;
                    this._ch = CHARACTERS[id];
                    this._saveState({character: id});
                    for (const a of [p.armL, p.armR, p.hat, ...p.legs, ...Object.values(p.faces), p.mouth])
                        a.remove_all_transitions();
                    p.char.remove_all_transitions();
                    p.char.destroy_all_children();
                    this._buildCharacter();
                    this._destroyMenus();
                    this._exhausted = false;
                    this._simulated = false;
                    this._cancel(this._snoreId);
                    p.bounce.set({rotation_angle_y: -90});
                    p.bounce.ease({rotation_angle_y: 0, scale_x: 1, scale_y: 1, duration: 360, mode: M.EASE_OUT_BACK,
                        onComplete: () => {
                            if (!this._p)
                                return;
                            p.bounce.set_pivot_point(0.5, 1.0);
                            this._switching = false;
                            this._busy = false;
                            this._resetPose();
                            this._sayNow(pick(this._ch.intro));
                            this._later(300, () => this._excited());
                            this._later(2500, () => this._checkLimit());
                        }});
                }});
        });
    }

    _addBlur(actor, radius) {
        try {
            actor.add_effect(new Shell.BlurEffect({
                mode: Shell.BlurMode.ACTOR,
                radius,
                brightness: 1.0,
            }));
        } catch (e) {
            logError(e, 'teman-ngoding: blur');
        }
    }

    // --- area layar --------------------------------------------------------

    // Maskot boleh tinggal di monitor mana saja. Batas gerak mengikuti monitor
    // tempat dia berada; saat diseret, monitor tujuan (bisa pindah monitor).

    _monitorAt(x, y) {
        // Monitor yang memuat titik tengah maskot di (x, y), atau yang terdekat
        const lm = Main.layoutManager;
        const cx = x + CHAR_W / 2, cy = y + ACTOR_H / 2;
        let best = lm.primaryMonitor, bestD = Infinity;
        for (const m of lm.monitors) {
            const dx = Math.max(m.x - cx, 0, cx - (m.x + m.width));
            const dy = Math.max(m.y - cy, 0, cy - (m.y + m.height));
            if (dx * dx + dy * dy < bestD) {
                best = m;
                bestD = dx * dx + dy * dy;
            }
        }
        return best;
    }

    _monitor() {
        const [x, y] = this._actor.get_position();
        return this._monitorAt(x, y);
    }

    _hasNeighbor(side, m = this._monitor()) {
        // Ada monitor lain yang menempel di sisi kiri (-1) / kanan (1)?
        return Main.layoutManager.monitors.some(o => o !== m &&
            (side < 0 ? o.x + o.width === m.x : o.x === m.x + m.width) &&
            o.y < m.y + m.height && m.y < o.y + o.height);
    }

    _wallSide() {
        // Sisi acak untuk adegan dinding; hindari sisi yang bersambung ke monitor lain
        const side = chance(2) ? -1 : 1;
        return this._hasNeighbor(side) && !this._hasNeighbor(-side) ? -side : side;
    }

    _workArea(m = this._monitor()) {
        return Main.layoutManager.getWorkAreaForMonitor(m.index);
    }

    _panelBottom(m = this._monitor()) {
        // Panel atas hanya ada di monitor utama
        if (m !== Main.layoutManager.primaryMonitor)
            return m.y;
        return m.y + (Main.layoutManager.panelBox?.height ?? 32);
    }

    _bounds(m = this._monitor()) {
        // Batas posisi aktor: bebas di dalam monitor, asal tetap terlihat
        return {
            minX: m.x,
            maxX: m.x + m.width - CHAR_W,
            minY: this._panelBottom(m) - Math.round(2.6 * U),
            maxY: m.y + m.height - ACTOR_H,
        };
    }

    // --- posisi & tumpukan -------------------------------------------------

    _place(pos) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        if (!pos) {
            pos = {
                x: monitor.x + (monitor.width - CHAR_W) / 2,
                y: monitor.y + (monitor.height - CHAR_H) / 2,
            };
        }
        this._moveTo(pos.x, pos.y);
    }

    _moveTo(x, y) {
        const b = this._bounds(this._monitorAt(x, y));
        this._actor.set_position(
            Math.round(clamp(x, b.minX, b.maxX)),
            Math.round(clamp(y, b.minY, b.maxY)));
    }

    _queueRestack() {
        if (this._restackLater || !this._actor)
            return;
        // Jalankan setelah Mutter selesai menyusun ulang aktor jendela
        this._restackLater = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => {
                this._restackLater = 0;
                this._restack();
                return GLib.SOURCE_REMOVE;
            });
    }

    _stackWatch() {
        this._later(1000, () => {
            this._restack();
            this._stackWatch();
        });
    }

    _restack() {
        // Tepat di atas jendela desktop (DING), di bawah jendela biasa.
        if (!this._actor || this._state === 'drag')
            return;
        const wg = global.window_group;
        const kids = wg.get_children();
        const mine = kids.indexOf(this._actor);
        if (this._stackAbove) {
            // Sedang duduk di atas jendela: tepat di atas jendela itu
            const wi = kids.indexOf(this._stackAbove);
            if (wi >= 0) {
                if (mine !== wi + 1)
                    wg.set_child_above_sibling(this._actor, this._stackAbove);
                return;
            }
            this._stackAbove = null;
        }
        let topDesktop = -1;
        kids.forEach((c, i) => {
            if (c.meta_window && isDesktopWindow(c))
                topDesktop = i;
        });
        if (topDesktop >= 0) {
            if (mine !== topDesktop + 1)
                wg.set_child_above_sibling(this._actor, kids[topDesktop]);
            return;
        }
        const bg = kids.findIndex(c => c instanceof Meta.BackgroundGroup);
        if (bg >= 0 && mine !== bg + 1)
            wg.set_child_above_sibling(this._actor, kids[bg]);
    }

    // State tersimpan: {x, y, character}
    _loadState() {
        for (const file of [STATE_FILE, OLD_STATE_FILE]) {
            try {
                const [ok, bytes] = GLib.file_get_contents(file);
                if (ok)
                    return JSON.parse(new TextDecoder().decode(bytes)) ?? {};
            } catch {
                // belum pernah disimpan
            }
        }
        return {};
    }

    _saveState(patch) {
        try {
            const data = {...this._loadState(), ...patch};
            GLib.file_set_contents(STATE_FILE, JSON.stringify(data));
        } catch (e) {
            logError(e, 'teman-ngoding: save state');
        }
    }

    _loadPosition() {
        const data = this._loadState();
        return Number.isFinite(data.x) && Number.isFinite(data.y) ? data : null;
    }

    _savePosition() {
        const [x, y] = this._actor.get_position();
        this._saveState({x, y, character: this._charId});
    }

    _debugLoop() {
        this._later(3000, () => {
            try {
                const [ax, ay] = this._actor.get_transformed_position();
                const [w, h] = this._actor.get_transformed_size();
                const cx = Math.round(ax + w / 2), cy = Math.round(ay + h / 2);
                const hit = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, cx, cy);
                const kids = global.window_group.get_children().map((c, i) => ({
                    i,
                    type: c.constructor.name,
                    title: c.meta_window?.get_title?.() ?? null,
                    me: c === this._actor,
                }));
                GLib.file_set_contents(DEBUG_FILE, JSON.stringify({
                    time: new Date().toISOString(),
                    hitIsMe: !!hit && (hit === this._actor || this._actor.contains(hit)),
                    hit: (() => {
                        const chain = [];
                        for (let x = hit; x && chain.length < 5; x = x.get_parent())
                            chain.push(`${x.constructor.name}${x.meta_window ? '[' + (x.meta_window.get_title() ?? '') + ']' : ''}`);
                        return chain.join(' < ');
                    })(),
                    buddyRect: [Math.round(ax), Math.round(ay), Math.round(w), Math.round(h)],
                    windows: global.get_window_actors().map(a => {
                        const r = a.meta_window.get_frame_rect();
                        return {title: a.meta_window.get_title(), visible: a.visible,
                            minimized: a.meta_window.minimized, rect: [r.x, r.y, r.width, r.height]};
                    }),
                    state: this._state,
                    busy: this._busy,
                    moving: this._moving,
                    windowGroup: kids,
                }, null, 1));
            } catch (e) {
                logError(e, 'teman-ngoding: debug');
            }
            this._debugLoop();
        });
    }

    // --- ekspresi ----------------------------------------------------------

    _setFace(face) {
        const p = this._p;
        const shown = face === 'blow' ? 'normal' : face;
        for (const [name, f] of Object.entries(p.faces))
            f.visible = name === shown;
        p.mouth.visible = face === 'blow';
    }

    _restingFace() {
        if (this._goingAway)
            return 'sad';
        if (this._exhausted)
            return this._state === 'drag' ? 'angry' : 'sleepy';
        if (this._state === 'drag')
            return 'dizzy';
        return this._state === 'hover' ? 'happy' : 'normal';
    }

    // --- animasi idle (loop terus) -----------------------------------------

    _loop(actor, props, duration, mode = M.EASE_IN_OUT_SINE) {
        actor.ease({
            ...props,
            duration,
            mode,
            repeat_count: -1,
            auto_reverse: true,
        });
    }

    _startFloat() {
        if (this._floatOn)
            return;
        const p = this._p;
        this._floatOn = true;
        this._loop(p.float, {translation_y: -7}, 1400);
        this._loop(p.float, {rotation_angle_z: 3}, 2200);
        this._loop(p.ground, {scale_x: 0.8, opacity: 150}, 1400);
    }

    _stopFloat() {
        const p = this._p;
        this._floatOn = false;
        p.float.remove_all_transitions();
        p.float.set({translation_y: 0, rotation_angle_z: 0});
        p.ground.remove_all_transitions();
        p.ground.set({scale_x: 1, opacity: 255});
    }

    _breathe() {
        const ch = this._p.char;
        ch.remove_all_transitions();
        ch.set_pivot_point(0.5, 1.0);
        ch.set({scale_x: 1, scale_y: 1});
        this._loop(ch, {scale_y: 0.96, scale_x: 1.03}, 1100);
    }

    _startIdle() {
        this._startFloat();
        this._breathe();
        this._armsIdle();
        this._scheduleBlink();
        this._scheduleAction();
        this._scheduleChat();
        this._scheduleLonely();
    }

    _armsIdle() {
        const p = this._p;
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        p.armL.rotation_angle_z = 0;
        p.armR.rotation_angle_z = 0;
        this._loop(p.armL, {rotation_angle_z: 10}, 900);
        this._loop(p.armR, {rotation_angle_z: -10}, 900);
    }

    _resetPose() {
        const p = this._p;
        p.bounce.remove_all_transitions();
        p.bounce.set_pivot_point(0.5, 1.0);
        p.bounce.set({translation_x: 0, translation_y: 0, rotation_angle_z: 0, scale_x: 1, scale_y: 1});
        p.legs.forEach(leg => {
            leg.remove_all_transitions();
            leg.set({translation_y: 0, rotation_angle_z: 0});
        });
        p.eyes.remove_all_transitions();
        p.eyes.set({scale_y: 1, translation_x: 0});
        p.hat.remove_all_transitions();
        p.hat.set({translation_y: 0, rotation_angle_y: 0, rotation_angle_z: 0});
        this._breathe();
        this._armsIdle();
        this._startFloat();
        this._setFace(this._restingFace());
        if (this._exhausted)
            this._sleepPose();
    }

    _scheduleBlink() {
        this._later(rand(2000, 5000), () => {
            this._blink(chance(3) ? 2 : 1);
            this._scheduleBlink();
        });
    }

    _blink(times) {
        if (this._state !== 'idle' || !this._p.eyes.visible)
            return;
        const eyes = this._p.eyes;
        eyes.ease({
            scale_y: 0.12,
            duration: 70,
            mode: M.EASE_IN_QUAD,
            onComplete: () => eyes.ease({
                scale_y: 1,
                duration: 90,
                mode: M.EASE_OUT_QUAD,
                onComplete: () => {
                    if (times > 1)
                        this._later(110, () => this._blink(times - 1));
                },
            }),
        });
    }

    _scheduleAction() {
        this._later(rand(2000, 4500), () => {
            if (this._state === 'idle' && !this._busy && !this._moving && !this._exhausted)
                this._randomAction();
            this._scheduleAction();
        });
    }

    _scheduleChat() {
        const low = (this._limitLevel()?.pct ?? 0) >= 80;
        this._later(low ? rand(7000, 14000) : rand(9000, 20000), () => {
            if (this._exhausted) {
                if (chance(3) && !this._p.bubble.root.visible)
                    this._say(pick(['Zzz... limit... habis... 😴', 'Nyam... token... 💤', '5 menit lagi... 😪',
                        'Zzz... jangan bangunin... 💤']));
            } else if (this._state === 'idle' && !this._p.bubble.root.visible) {
                this._say(this._chatLine());
            }
            this._scheduleChat();
        });
    }

    _scheduleLonely() {
        // Sedih kalau lama tidak disapa
        this._later(60000, () => {
            const idleMin = (Date.now() - this._lastInteraction) / 60000;
            if (idleMin > 5 && this._state === 'idle' && !this._busy && !this._moving && !this._exhausted && chance(3))
                this._moodSad('Abang lupa sama aku ya? 🥺');
            this._scheduleLonely();
        });
    }

    _wasTurnedOff() {
        // Penanda "pernah dimatikan lewat menu" disimpan di file posisi
        const flag = GLib.build_filenamev([GLib.get_user_cache_dir(), 'teman-ngoding-was-off']);
        const was = GLib.file_test(flag, GLib.FileTest.EXISTS);
        if (was)
            Gio.File.new_for_path(flag).delete(null);
        return was;
    }

    _menuOpen() {
        return !!(this._menu?.isOpen || this._statusMenu?.isOpen);
    }

    _randomInPlace() {
        // Menu sedang terbuka: tetap hidup, tapi tidak pindah tempat
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastScene > 15000 && chance(3)) {
            this._lastScene = now;
            pick([
                () => this._sceneBall(), () => this._sceneYoyo(),
                () => this._sceneBubbles(), () => this._sceneCode(),
                () => this._sceneGuitar(), () => this._sceneCoffee(),
                () => this._scenePlane(), () => this._sceneJumpRope(),
                () => this._sceneBalloon(), () => this._sceneBook(),
                () => this._sceneMagic(), () => this._sceneRubik(),
                () => this._sceneSelfie(),
            ])();
            return;
        }
        pick([
            () => this._wave(), () => this._wave(),
            () => this._tapFeet(), () => this._lookAround(),
            () => this._hop(), () => this._dance(), () => this._dance(),
            () => this._excited(), () => this._salto(),
            () => this._moodWeird(true),
            () => this._say(pick(['Pilih yang mana nih? 🤔', 'Aku tungguin ya~ ⏳',
                'Ayo klik salah satu! 👆', 'Hmm hmm~ 🎵'])),
        ])();
    }

    _randomAction() {
        if (this._menuOpen()) {
            this._randomInPlace();
            return;
        }
        const lvl = this._limitLevel()?.pct ?? 0;
        if (lvl >= 80 && chance(lvl >= 90 ? 4 : 6)) {
            if (chance(2))
                this._yawn();
            else
                this._moodSad(this._complaint());
            return;
        }
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastScene > 18000 && chance(3)) {
            this._lastScene = now;
            if (isLateNight() && chance(2)) {
                this._sceneSleep();
            } else {
                pick([
                    () => this._sceneBall(), () => this._sceneYoyo(),
                    () => this._sceneBubbles(), () => this._sceneCode(),
                    () => this._sceneGuitar(), () => this._sceneCoffee(),
                    () => this._scenePlane(), () => this._sceneJumpRope(),
                    () => this._sceneBalloon(), () => this._sceneSkate(),
                    () => this._sceneBook(), () => this._sceneMagic(),
                    () => this._sceneRubik(), () => this._sceneSelfie(),
                ])();
            }
            return;
        }
        // Interaksi dengan layar paling sering (~40%), lalu jalan-jalan (~20%)
        const r = rand(0, 40);
        if (r < 8)
            this._explore();
        else if (r < 23)
            this._edgeTrip();
        else if (r < 26)
            this._salto();
        else if (r < 27)
            this._wave();
        else if (r < 28)
            this._tapFeet();
        else if (r < 29)
            this._lookAround();
        else if (r < 31)
            this._hop();
        else if (r < 33)
            this._dance();
        else if (r < 34)
            this._excited();
        else if (r < 36)
            this._moodAngry();
        else if (r < 38)
            this._moodSad();
        else
            this._moodWeird();
    }

    // --- aksi dasar --------------------------------------------------------

    _wave(times = 3) {
        const arm = this._p.armR;
        arm.remove_all_transitions();
        const swing = n => {
            if (!this._p)
                return;
            if (n <= 0) {
                arm.ease({
                    rotation_angle_z: 0,
                    duration: 160,
                    mode: M.EASE_OUT_QUAD,
                    onComplete: () => this._p && this._state !== 'drag' && !this._moving &&
                        this._loop(arm, {rotation_angle_z: -10}, 900),
                });
                return;
            }
            arm.ease({
                rotation_angle_z: -75,
                duration: 140,
                mode: M.EASE_OUT_QUAD,
                onComplete: () => arm.ease({
                    rotation_angle_z: -35,
                    duration: 140,
                    mode: M.EASE_IN_OUT_QUAD,
                    onComplete: () => swing(n - 1),
                }),
            });
        };
        swing(times);
    }

    _tapFeet() {
        this._p.legs.forEach((leg, i) => {
            for (const k of [0, 1]) {
                this._later(i * 90 + k * 420, () => leg.ease({
                    translation_y: -0.6 * U,
                    duration: 90,
                    mode: M.EASE_OUT_QUAD,
                    onComplete: () => leg.ease({
                        translation_y: 0,
                        duration: 140,
                        mode: M.EASE_OUT_BOUNCE,
                    }),
                }));
            }
        });
    }

    _lookAround() {
        const eyes = this._p.eyes;
        const look = (x, delay) => this._later(delay, () => eyes.ease({
            translation_x: x,
            duration: 160,
            mode: M.EASE_OUT_QUAD,
        }));
        look(-0.75 * U, 0);
        look(0.75 * U, 650);
        look(0, 1300);
    }

    _hop(height = 2.2 * U, onDone) {
        const b = this._p.bounce;
        this._busy = true;
        b.ease({
            scale_y: 0.82,
            scale_x: 1.12,
            duration: 90,
            mode: M.EASE_OUT_QUAD,
            onComplete: () => b.ease({
                translation_y: -height,
                scale_y: 1.08,
                scale_x: 0.94,
                duration: 170,
                mode: M.EASE_OUT_QUAD,
                onComplete: () => b.ease({
                    translation_y: 0,
                    scale_y: 1,
                    scale_x: 1,
                    duration: 190,
                    mode: M.EASE_IN_QUAD,
                    onComplete: () => this._land(onDone),
                }),
            }),
        });
        this._p.hat.ease({
            translation_y: -0.6 * U,
            duration: 170,
            mode: M.EASE_OUT_QUAD,
            onComplete: () => this._p?.hat.ease({
                translation_y: 0,
                duration: 300,
                mode: M.EASE_OUT_BOUNCE,
            }),
        });
    }

    _land(onDone) {
        const b = this._p.bounce;
        b.ease({
            scale_y: 0.86,
            scale_x: 1.1,
            duration: 80,
            mode: M.EASE_OUT_QUAD,
            onComplete: () => b.ease({
                scale_y: 1,
                scale_x: 1,
                duration: 420,
                mode: M.EASE_OUT_ELASTIC,
                onComplete: () => {
                    if (!this._sceneToken)
                        this._busy = false;
                    onDone?.();
                },
            }),
        });
    }

    _salto(onDone) {
        const p = this._p;
        const b = p.bounce;
        this._busy = true;
        const turns = chance(4) ? 2 : 1;
        const dir = chance(3) ? -1 : 1;
        const height = turns === 2 ? 11 * U : 8 * U;
        const air = turns === 2 ? 760 : 560;

        b.ease({
            scale_y: 0.78,
            scale_x: 1.15,
            duration: 120,
            mode: M.EASE_OUT_QUAD,
            onComplete: () => {
                this._setFace('happy');
                p.armL.remove_all_transitions();
                p.armR.remove_all_transitions();
                p.armL.ease({rotation_angle_z: 70, duration: 150, mode: M.EASE_OUT_QUAD});
                p.armR.ease({rotation_angle_z: -70, duration: 150, mode: M.EASE_OUT_QUAD});
                b.set({scale_x: 1, scale_y: 1});
                b.set_pivot_point(0.5, 0.55);
                b.ease({
                    rotation_angle_z: 360 * turns * dir,
                    duration: air,
                    mode: M.EASE_IN_OUT_QUAD,
                });
                b.ease({
                    translation_y: -height,
                    duration: air / 2,
                    mode: M.EASE_OUT_QUAD,
                    onComplete: () => b.ease({
                        translation_y: 0,
                        duration: air / 2,
                        mode: M.EASE_IN_QUAD,
                        onComplete: () => {
                            b.rotation_angle_z = 0;
                            b.set_pivot_point(0.5, 1.0);
                            this._armsIdle();
                            this._land(() => {
                                this._later(500, () => this._setFace(this._restingFace()));
                                if (chance(2))
                                    this._say(pick(SALTO_PHRASES));
                                onDone?.();
                            });
                        },
                    }),
                });
            },
        });
    }

    _dance() {
        const b = this._p.bounce;
        this._busy = true;
        this._setFace('happy');
        const steps = [-10, 10, -10, 10, -8, 8, 0];
        const step = i => {
            if (!this._p)
                return;
            if (i >= steps.length) {
                this._busy = false;
                this._setFace(this._restingFace());
                return;
            }
            const leg = this._p.legs[i % 2 ? 2 : 1];
            leg.ease({
                translation_y: -0.6 * U,
                duration: 90,
                mode: M.EASE_OUT_QUAD,
                onComplete: () => leg.ease({translation_y: 0, duration: 90, mode: M.EASE_IN_QUAD}),
            });
            b.ease({
                rotation_angle_z: steps[i],
                translation_y: i % 2 ? -4 : 0,
                duration: 180,
                mode: M.EASE_IN_OUT_SINE,
                onComplete: () => step(i + 1),
            });
        };
        if (chance(2))
            this._say(pick(['Joget dulu ah~ 💃', 'Musik mana musik! 🎶', 'Goyang dikit 🕺']));
        step(0);
    }

    _excited() {
        this._setFace('happy');
        if (chance(2))
            this._say(pick(EXCITED_PHRASES));
        this._p.hat.ease({
            rotation_angle_y: 360,
            duration: 600,
            mode: M.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._p)
                    this._p.hat.rotation_angle_y = 0;
            },
        });
        this._hop(3.6 * U, () => this._later(500, () => this._setFace(this._restingFace())));
    }

    // --- emosi -------------------------------------------------------------

    _moodAngry(text) {
        const alive = this._startScene();
        const p = this._p;
        this._setFace('angry');
        this._say(text ?? pick(ANGRY_PHRASES));
        let n = 0;
        const stomp = () => {
            if (!alive())
                return;
            p.bounce.ease({translation_x: 0, duration: 60});
            p.legs.forEach((leg, i) => this._later(i * 120, () => leg.ease({
                translation_y: -U,
                duration: 80,
                mode: M.EASE_OUT_QUAD,
                onComplete: () => leg.ease({translation_y: 0, duration: 100, mode: M.EASE_IN_QUAD}),
            })));
            this._hop(1.2 * U);
            this._later(1100, () => alive() && this._endScene());
        };
        const shake = () => {
            if (!alive())
                return;
            n++;
            p.bounce.ease({translation_x: n % 2 ? 4 : -4, duration: 45, mode: M.LINEAR,
                onComplete: () => (n < 16 ? shake() : stomp())});
        };
        for (let i = 0; i < 3; i++) {
            this._later(i * 350, () => alive() && this._floatLabel(i === 0 ? '💢' : '💨',
                'ngoding-emote', rand(1, 13) * U, 0, {dy: -45, duration: 900}));
        }
        shake();
    }

    _moodSad(text) {
        const alive = this._startScene();
        const p = this._p;
        this._setFace('sad');
        this._say(text ?? pick([...SAD_PHRASES, ...this._ch.sad]));
        p.char.remove_all_transitions();
        p.char.ease({scale_y: 0.9, scale_x: 1.04, duration: 700, mode: M.EASE_IN_OUT_SINE});
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        p.armL.ease({rotation_angle_z: -30, duration: 600});
        p.armR.ease({rotation_angle_z: 30, duration: 600});
        p.hat.ease({rotation_angle_z: -12, translation_y: 0.3 * U, duration: 600});
        let n = 0;
        const tear = () => {
            if (!alive())
                return;
            for (const ex of [5.3, 10.3]) {
                const t = this._prop(shape(0.5 * U, 0.8 * U, TOY.tear), ex * U, 6.2 * U);
                t.ease({translation_y: 4 * U, opacity: 0, duration: 900, mode: M.EASE_IN_QUAD,
                    onComplete: () => t.destroy()});
            }
            n++;
            if (n < 5)
                this._later(650, tear);
            else
                this._later(900, () => alive() && this._endScene());
        };
        this._later(500, tear);
    }

    _moodWeird(stayInPlace = false) {
        const alive = this._startScene();
        const p = this._p;
        this._setFace('weird');
        this._say(pick(this._weirdPhrases()));
        const variant = rand(0, stayInPlace ? 2 : 3);
        if (variant === 0) {
            // berputar pelan di tempat
            p.bounce.set_pivot_point(0.5, 0.55);
            p.bounce.ease({rotation_angle_z: 360, duration: 1800, mode: M.EASE_IN_OUT_SINE,
                onComplete: () => alive() && this._endScene()});
        } else if (variant === 1) {
            // glitch: loncat-loncat acak
            let n = 0;
            const glitch = () => {
                if (!alive())
                    return;
                p.bounce.set({translation_x: rand(-8, 9), translation_y: rand(-8, 3),
                    scale_x: 1 + rand(-10, 11) / 100});
                if (++n < 14)
                    this._later(90, glitch);
                else
                    this._endScene();
            };
            glitch();
        } else {
            // moonwalk mundur sedikit
            const [x] = this._actor.get_position();
            const dir = chance(2) ? 1 : -1;
            const b = this._bounds();
            const tx = clamp(x + dir * 10 * U, b.minX, b.maxX);
            p.legs.forEach((leg, i) => this._loop(leg, {rotation_angle_z: i % 2 ? 15 : -15}, 200));
            this._actor.ease({
                x: tx, duration: 1600, mode: M.LINEAR,
                onComplete: () => {
                    if (!alive())
                        return;
                    this._savePosition();
                    this._endScene();
                },
            });
        }
    }

    // --- limit habis: tidur ---------------------------------------------

    _scheduleLimitCheck() {
        this._later(30000, () => {
            this._checkLimit();
            this._checkSystem();
            this._scheduleLimitCheck();
        });
    }

    _checkSystem() {
        if (!this._sys || this._exhausted || this._state === 'drag')
            return;
        const now = Date.now();
        const once = (key, ms = 600000) => {
            if (now - (this._warned[key] ?? 0) < ms)
                return false;
            this._warned[key] = now;
            return true;
        };
        try {
            const b = this._sys.battery();
            if (b && b.status === 'Discharging' && b.pct !== null && b.pct <= 15 && once('battery')) {
                this._moodSad(`Baterai tinggal ${b.pct}%! Cas dong bang 🪫`);
                return;
            }
            const t = this._sys.temps().cpu;
            if (t && t >= 85 && once('temp')) {
                this._say(`Panas banget! CPU ${t}°C 🥵 Kasih napas dong`);
                return;
            }
            const m = this._sys.mem();
            if (m && m.pct >= 90 && once('ram'))
                this._say(`RAM kepake ${m.pct}%! Tutup beberapa tab yuk 😵`);
        } catch (e) {
            logError(e, 'teman-ngoding: check system');
        }
    }

    _limitHit() {
        const u = this._usage();
        if (!u)
            return null;
        const hit = [['sesi', u.session], ['mingguan', u.weekly]]
            .filter(([, v]) => v && v.percent >= 100);
        return hit.length ? hit : null;
    }

    _resetText() {
        const hit = this._limitHit();
        if (!hit)
            return null;
        // reset paling akhir yang menentukan kapan bisa dipakai lagi
        const latest = hit.map(([, v]) => v.resets_at).filter(Boolean).sort().at(-1);
        return latest ? relativeTime(latest) : null;
    }

    _limitLevel() {
        // Limit paling tinggi di antara sesi & mingguan
        const u = this._usage();
        if (!u)
            return null;
        const parts = [['sesi', u.session], ['mingguan', u.weekly]].filter(([, v]) => v);
        if (!parts.length)
            return null;
        const [name, top] = parts.reduce((a, b) => (b[1].percent > a[1].percent ? b : a));
        return {name, pct: Math.round(top.percent), when: relativeTime(top.resets_at)};
    }

    _complaint() {
        const l = this._limitLevel();
        if (!l || l.pct < 80)
            return null;
        const left = 100 - l.pct;
        const list = [
            `Limit ${l.name} udah ${l.pct}%... hemat-hemat ya 😩`,
            `Tenagaku tinggal ${left}% 😮‍💨`,
            `Reset ${l.when}... masih lama 😭`,
            `Pakai Claude-nya dikit-dikit dulu ya bang 🙏`,
            'Kalau limitnya habis, aku tidur lho... 😪',
            'Jangan suruh refactor gede dulu ya 😰',
            'Tokenku menipis... 🫠',
            'Aku lemes... butuh reset limit 🥱',
            'Prompt-nya yang singkat-singkat aja ya 🥺',
            `Sisa ${left}%... rasanya kayak HP baterai merah 🪫`,
            'Hemat token = hemat tenagaku 🙇',
        ];
        if (l.pct >= 90) {
            list.push(
                `🚨 KRITIS! Limit ${l.name} ${l.pct}%!`,
                'Tolong jangan pecut aku dulu, limitku tipis 😭',
                `Tinggal ${left}%!! Aku udah mau pingsan 😵`,
                'Satu prompt lagi dan aku tumbang... 🫥',
            );
        }
        return pick(list);
    }

    _chatLine() {
        // Limit tipis: laptop 45%, keluhan 35%, umum 20%. Normal: laptop 55%, umum 45%.
        const low = (this._limitLevel()?.pct ?? 0) >= 80;
        const r = rand(0, 100);
        const fact = () => this._sys?.randomPhrase() ?? null;
        if (low) {
            if (r < 45)
                return fact() ?? this._complaint() ?? pick(this._phrases());
            if (r < 80)
                return this._complaint() ?? fact() ?? pick(this._phrases());
            return pick(this._phrases());
        }
        return (r < 55 ? fact() : null) ?? pick(this._phrases());
    }

    _yawn() {
        const alive = this._startScene();
        this._setFace('sleepy');
        this._p.char.remove_all_transitions();
        this._p.char.ease({scale_y: 1.08, scale_x: 0.95, duration: 500, mode: M.EASE_OUT_QUAD,
            onComplete: () => this._p?.char.ease({scale_y: 1, scale_x: 1, duration: 500})});
        this._say(pick(['Hoaam... 🥱', 'Hoaaam~ limit tipis bikin ngantuk 🥱']));
        this._later(1800, () => alive() && this._endScene());
    }

    _checkLimit() {
        if (!this._actor || this._state === 'drag' || this._simulated)
            return;
        const hit = this._limitHit();
        if (!hit)
            this._manualAwake = false; // limit sudah reset
        if (hit && !this._exhausted && !this._manualAwake)
            this._enterExhausted(hit);
        else if (!hit && this._exhausted)
            this._exitExhausted();
    }

    _enterExhausted(hit) {
        this._interrupt();
        this._exhausted = true;
        this._sleepPose();
        this._sayNow(`Limit ${hit.map(([n]) => n).join(' & ')} habis... aku tidur dulu ya 😴`);
        this._snore();
    }

    _exitExhausted(simulated = false) {
        this._exhausted = false;
        this._cancel(this._snoreId);
        this._interrupt();
        this._resetPose();
        this._sayNow(simulated ? pick(['Hoaam~ udah bangun! ☀️', 'Pagi! Segar lagi 😆'])
            : 'Limit udah reset! Aku bangun~ 🎉');
        this._later(400, () => this._excited());
    }

    _toggleSleepSim() {
        if (this._exhausted) {
            // Bangunin (simulasi maupun limit asli). Kalau limit asli habis,
            // tetap bangun sampai limitnya reset.
            const real = !this._simulated;
            this._simulated = false;
            this._manualAwake = real;
            this._exitExhausted(true);
            if (real)
                this._later(2600, () => this._sayNow('Limitnya masih habis sih, tapi oke aku melek 🥱'));
        } else {
            this._manualAwake = false;
            this._simulated = true;
            this._enterExhausted([['sesi', null]]);
        }
    }

    _sleepPose() {
        const p = this._p;
        this._setFace(this._state === 'drag' ? 'angry' : 'sleepy');
        p.char.remove_all_transitions();
        p.char.set_pivot_point(0.5, 1.0);
        p.char.set({scale_x: 1, scale_y: 1});
        this._loop(p.char, {scale_y: 0.9, scale_x: 1.05}, 1600);
        p.hat.ease({rotation_angle_z: -14, translation_y: 0.3 * U, duration: 400});
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        p.armL.ease({rotation_angle_z: -25, duration: 400});
        p.armR.ease({rotation_angle_z: 25, duration: 400});
    }

    _snore() {
        if (!this._exhausted)
            return;
        if (!this._sceneToken && this._state !== 'drag') {
            this._floatLabel(chance(3) ? 'Z' : 'z', 'ngoding-z', rand(11, 13) * U, U,
                {dx: rand(10, 30), dy: -60, duration: 1700});
        }
        this._snoreId = this._later(900, () => this._snore());
    }

    _angryWake() {
        const alive = this._startScene();
        const p = this._p;
        this._setFace('angry');
        const when = this._resetText();
        this._sayNow(pick([
            'Ssst! Aku lagi tidur, limitnya habis! 😤',
            when ? `Bangunin ${when} ya! 😠` : 'Bangunin pas limit reset ya! 😠',
            'Udah dibilang limit habis! 💢',
            'Hmph! Ganggu orang tidur aja 😤',
            when ? `Limit reset ${when}, sabar dong! 😡` : 'Sabar dong, limitnya belum reset! 😡',
        ]));
        this._floatLabel('💢', 'ngoding-emote', rand(10, 14) * U, 0, {dy: -45, duration: 900});
        let n = 0;
        const shake = () => {
            if (!alive())
                return;
            p.bounce.ease({translation_x: n % 2 ? 5 : -5, duration: 45, mode: M.LINEAR,
                onComplete: () => {
                    if (++n < 14) {
                        shake();
                        return;
                    }
                    p.bounce.ease({translation_x: 0, duration: 60});
                    p.legs.forEach((leg, i) => this._later(i * 110, () => leg.ease({
                        translation_y: -U, duration: 80, mode: M.EASE_OUT_QUAD,
                        onComplete: () => leg.ease({translation_y: 0, duration: 100}),
                    })));
                    this._later(1800, () => alive() && this._endScene());
                }});
        };
        shake();
    }

    // --- lari & tepi layar -------------------------------------------------

    _runTo(x, y, onArrive) {
        const b = this._bounds();
        x = Math.round(clamp(x, b.minX, b.maxX));
        y = Math.round(clamp(y, b.minY, b.maxY));
        const [cx, cy] = this._actor.get_position();
        const dist = Math.hypot(x - cx, y - cy);
        if (dist < 4) {
            onArrive?.();
            return;
        }
        const p = this._p;
        const dir = x >= cx ? 1 : -1;
        const speed = rand(230, 380);
        this._moving = true;
        this._busy = true;

        // pose lari
        p.bounce.ease({rotation_angle_z: 6 * dir, duration: 150});
        p.eyes.ease({translation_x: 0.6 * U * dir, duration: 150});
        p.legs.forEach((leg, i) => {
            leg.remove_all_transitions();
            leg.translation_y = i % 2 ? 0 : -0.7 * U;
            this._loop(leg, {translation_y: i % 2 ? -0.7 * U : 0}, 110, M.LINEAR);
        });
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        p.armL.rotation_angle_z = -25;
        p.armR.rotation_angle_z = -25;
        this._loop(p.armL, {rotation_angle_z: 25}, 220);
        this._loop(p.armR, {rotation_angle_z: 25}, 220);
        if (chance(3))
            this._say(pick(['Lari~ 🏃', 'Jalan-jalan dulu ah 🚶', 'Ke sana yuk! 👉', 'Wuuush 💨']));

        const dust = () => {
            if (!this._moving)
                return;
            this._floatLabel('💨', 'ngoding-dust',
                dir > 0 ? 0 : CHAR_W - 2 * U, CHAR_H - 2 * U,
                {dx: -dir * 20, dy: -6, duration: 500});
            this._dustId = this._later(240, dust);
        };
        dust();

        this._actor.ease({
            x, y,
            duration: Math.max(300, dist / speed * 1000),
            mode: M.LINEAR,
            onComplete: () => {
                if (!this._moving)
                    return;
                this._stopRun();
                this._savePosition();
                onArrive?.();
            },
        });
    }

    _stopRun() {
        if (!this._moving)
            return;
        this._moving = false;
        this._busy = false;
        this._cancel(this._dustId);
        this._actor.remove_transition('x');
        this._actor.remove_transition('y');
        this._resetPose();
    }

    _explore() {
        const wa = this._workArea();
        const x = rand(wa.x, wa.x + wa.width - CHAR_W);
        const y = rand(wa.y + 4 * U, wa.y + wa.height - ACTOR_H);
        this._runTo(x, y, () => this._checkEdges());
    }

    _edgeTrip() {
        // Interaksi dengan layar, dipilih berbobot
        const options = [
            [3, () => this._climbWall(this._wallSide())],
            [3, () => this._goHangTop()],
            [2, () => this._peekBottom()],
            [2, () => this._peekSide(this._wallSide())],
            [3, () => this._sitOnWindow()],
            [1, () => this._glassPress()],
            [1, () => this._goWall(this._wallSide())],
            [2, () => this._goBottom()],
        ];
        const total = options.reduce((s, [w]) => s + w, 0);
        let r = rand(0, total);
        for (const [w, fn] of options) {
            if (r < w) {
                fn();
                return;
            }
            r -= w;
        }
    }

    _goWall(side) {
        const wa = this._workArea();
        const b = this._bounds();
        const [, cy] = this._actor.get_position();
        this._runTo(side < 0 ? b.minX : b.maxX, clamp(cy, wa.y + 4 * U, b.maxY), () => this._edgeWall(side));
    }

    _goBottom() {
        const wa = this._workArea();
        const b = this._bounds();
        this._runTo(rand(wa.x + wa.width * 0.2, wa.x + wa.width * 0.8 - CHAR_W), b.maxY, () => this._edgeBottom());
    }

    _goHangTop() {
        const wa = this._workArea();
        const b = this._bounds();
        this._runTo(rand(wa.x, wa.x + wa.width - CHAR_W), b.minY, () => this._edgeTop());
    }

    _snapInside() {
        // Pastikan maskot kembali sepenuhnya di dalam layar
        const b = this._bounds();
        const [x, y] = this._actor.get_position();
        const nx = Math.round(clamp(x, b.minX, b.maxX));
        const ny = Math.round(clamp(y, b.minY, b.maxY));
        if (nx !== Math.round(x) || ny !== Math.round(y)) {
            this._actor.ease({x: nx, y: ny, duration: 300, mode: M.EASE_OUT_QUAD,
                onComplete: () => this._savePosition()});
        }
    }

    _climbWall(side) {
        const b = this._bounds();
        const [, cy] = this._actor.get_position();
        const startY = clamp(cy, b.minY + 12 * U, b.maxY);
        this._runTo(side < 0 ? b.minX : b.maxX, startY, () => {
            const alive = this._startScene();
            const p = this._p;
            this._stopFloat();
            this._setFace('happy');
            this._say(pick(['Manjat dinding! 🧗', 'Spiderman mode 🕷️', 'Ke atas yuk! ⬆️']));
            p.bounce.ease({rotation_angle_z: 0, duration: 150});
            p.eyes.ease({translation_x: 0, duration: 150});
            // tangan & kaki bergantian memanjat
            p.armL.remove_all_transitions();
            p.armR.remove_all_transitions();
            p.armL.rotation_angle_z = 60;
            p.armR.rotation_angle_z = -120;
            this._loop(p.armL, {rotation_angle_z: 120}, 260);
            this._loop(p.armR, {rotation_angle_z: -60}, 260);
            p.legs.forEach((leg, i) => {
                leg.translation_y = i % 2 ? 0 : -0.6 * U;
                this._loop(leg, {translation_y: i % 2 ? -0.6 * U : 0}, 260, M.LINEAR);
            });

            const [, y0] = this._actor.get_position();
            const dist = y0 - b.minY;
            if (chance(4) && dist > 10 * U) {
                // tergelincir di tengah jalan
                this._actor.ease({
                    y: y0 - dist / 2, duration: dist / 2 / 120 * 1000, mode: M.LINEAR,
                    onComplete: () => {
                        if (!alive())
                            return;
                        this._setFace('dizzy');
                        this._say('Licin! 😱');
                        p.armL.remove_all_transitions();
                        p.armR.remove_all_transitions();
                        p.armL.ease({rotation_angle_z: 90, duration: 120});
                        p.armR.ease({rotation_angle_z: -90, duration: 120});
                        this._actor.ease({
                            y: y0, duration: 500, mode: M.EASE_IN_QUAD,
                            onComplete: () => {
                                if (!alive())
                                    return;
                                this._savePosition();
                                this._land(() => this._endScene());
                            },
                        });
                    },
                });
                return;
            }
            this._actor.ease({
                y: b.minY, duration: Math.max(400, dist / 120 * 1000), mode: M.LINEAR,
                onComplete: () => alive() && this._hang(alive),
            });
        });
    }

    _peekBottom() {
        const m = this._monitor();
        const b = this._bounds();
        // hindari tengah bawah (dock)
        const x = chance(2)
            ? rand(m.x + U, m.x + m.width * 0.3)
            : rand(m.x + m.width * 0.7 - CHAR_W, m.x + m.width - CHAR_W - U);
        this._runTo(x, b.maxY, () => {
            const alive = this._startScene();
            const p = this._p;
            this._stopFloat();
            const bottom = m.y + m.height;
            this._actor.ease({
                y: bottom - U, duration: 350, mode: M.EASE_IN_QUAD,
                onComplete: () => this._later(900, () => {
                    if (!alive())
                        return;
                    this._setFace('normal');
                    // muncul pelan, hanya hiasan kepala & mata
                    this._actor.ease({
                        y: bottom - Math.round(6.6 * U), duration: 700, mode: M.EASE_OUT_QUAD,
                        onComplete: () => {
                            if (!alive())
                                return;
                            this._say(pick(['Cilukba~ 👀', 'Psst... ada orang? 👀']));
                            p.eyes.ease({translation_x: -0.7 * U, duration: 200});
                            this._later(700, () => alive() && p.eyes.ease({translation_x: 0.7 * U, duration: 300}));
                            this._later(1700, () => {
                                if (!alive())
                                    return;
                                p.eyes.ease({translation_x: 0, duration: 100});
                                this._setFace('happy');
                                this._say(pick(['BA! 😆', 'Kaget gak? 😝']));
                                this._actor.ease({
                                    y: b.maxY - 3 * U, duration: 260, mode: M.EASE_OUT_BACK,
                                    onComplete: () => {
                                        if (!alive())
                                            return;
                                        this._actor.ease({y: b.maxY, duration: 260, mode: M.EASE_IN_QUAD,
                                            onComplete: () => alive() && this._land(() => this._endScene())});
                                    },
                                });
                            });
                        },
                    });
                }),
            });
        });
    }

    _peekSide(side) {
        const m = this._monitor();
        const b = this._bounds();
        const wa = this._workArea();
        const [, cy] = this._actor.get_position();
        this._runTo(side < 0 ? b.minX : b.maxX, clamp(cy, wa.y + 4 * U, b.maxY), () => {
            const alive = this._startScene();
            const p = this._p;
            const outX = side < 0 ? m.x - Math.round(CHAR_W * 0.62) : m.x + m.width - Math.round(CHAR_W * 0.38);
            this._actor.ease({
                x: outX, duration: 500, mode: M.EASE_IN_OUT_QUAD,
                onComplete: () => {
                    if (!alive())
                        return;
                    p.eyes.ease({translation_x: -0.8 * U * side, duration: 200});
                    p.bounce.ease({rotation_angle_z: -10 * side, duration: 300});
                    this._say(pick(['Psst... di sini 👀', 'Aku ngumpet~ 🫣', 'Gak keliatan kan? 🙈']));
                    this._later(2600, () => {
                        if (!alive())
                            return;
                        p.bounce.ease({rotation_angle_z: 0, duration: 200});
                        this._setFace('happy');
                        this._say(pick(['Hehe ketahuan 😝', 'Tadaa~ ✨']));
                        this._actor.ease({
                            x: side < 0 ? b.minX : b.maxX, duration: 350, mode: M.EASE_OUT_BACK,
                            onComplete: () => alive() && this._hop(1.6 * U, () => this._endScene()),
                        });
                    });
                },
            });
        });
    }

    _pickWindow() {
        const b = this._bounds();
        const ws = global.workspace_manager.get_active_workspace();
        const wins = global.get_window_actors().filter(a => {
            const w = a.meta_window;
            if (!w || !a.visible || w.minimized || w.is_fullscreen())
                return false;
            if (w.get_window_type() !== Meta.WindowType.NORMAL || !w.located_on_workspace(ws))
                return false;
            const r = w.get_frame_rect();
            return r.width > CHAR_W * 1.5 && r.y - CHAR_H > b.minY;
        });
        return wins.at(-1) ?? null; // jendela paling depan
    }

    _sitOnWindow() {
        const win = this._pickWindow();
        if (!win) {
            this._explore();
            return;
        }
        const rect = win.meta_window.get_frame_rect();
        const offX = rand(0, rect.width - CHAR_W);
        const seatY = () => win.meta_window.get_frame_rect().y - CHAR_H + Math.round(0.8 * U);
        this._runTo(rect.x + offX, seatY(), () => {
            const alive = this._startScene();
            const p = this._p;
            this._stackAbove = win;
            this._restack();
            this._stopFloat();
            this._setFace('happy');
            this._say(pick(['Duduk di atas jendela~ 🪟', 'Pemandangan dari sini bagus 😎',
                'Jendela ini empuk juga 🛋️', 'Geser jendelanya, aku ikut! 🎢']));
            p.legs.forEach((leg, i) => this._loop(leg, {rotation_angle_z: i % 2 ? 22 : -22}, 420));
            p.armL.remove_all_transitions();
            p.armR.remove_all_transitions();
            p.armL.ease({rotation_angle_z: -20, duration: 300});
            p.armR.ease({rotation_angle_z: 20, duration: 300});

            const fall = () => {
                this._stackAbove = null;
                this._setFace('dizzy');
                this._say(pick(['Eh jendelanya hilang! 😱', 'Waaa jatuh! 😵']));
                const b = this._bounds();
                const [x, y] = this._actor.get_position();
                this._actor.ease({
                    x: clamp(x, b.minX, b.maxX), y: clamp(y + 10 * U, b.minY, b.maxY),
                    duration: 450, mode: M.EASE_IN_QUAD,
                    onComplete: () => alive() && this._land(() => this._endScene()),
                });
            };
            // ikut terbawa saat jendela digeser
            const follow = () => {
                if (!alive())
                    return;
                const w = win.meta_window;
                if (!w || w.minimized || !win.visible || !win.get_parent()) {
                    fall();
                    return;
                }
                const r = w.get_frame_rect();
                this._actor.set_position(r.x + Math.min(offX, Math.max(0, r.width - CHAR_W)), seatY());
                this._followId = this._later(40, follow);
            };
            follow();

            this._later(rand(6000, 9500), () => {
                if (!alive())
                    return;
                this._cancel(this._followId);
                this._stackAbove = null;
                this._say(pick(['Turun ah~ 🪂', 'Hup! 🤸']));
                const b = this._bounds();
                const [x, y] = this._actor.get_position();
                const ty = clamp(y + rand(6 * U, 12 * U), b.minY, b.maxY);
                if (chance(2)) {
                    this._actor.ease({y: ty, duration: 450, mode: M.EASE_IN_QUAD,
                        onComplete: () => alive() && this._land(() => this._endScene())});
                } else {
                    this._actor.ease({y: ty, duration: 560, mode: M.EASE_IN_OUT_QUAD,
                        onComplete: () => alive() && this._savePosition()});
                    this._salto(() => alive() && this._endScene());
                }
                this._later(10, () => this._restack());
                void x;
            });
        });
    }

    _glassPress() {
        // Maju ke arah "kaca" layar, muka gepeng, lalu ketuk-ketuk
        const alive = this._startScene();
        const p = this._p;
        this._stopFloat();
        this._setFace('happy');
        this._actor.set_pivot_point(0.5, 0.5);
        this._actor.ease({scale_x: 1.6, scale_y: 1.6, duration: 450, mode: M.EASE_IN_QUAD,
            onComplete: () => {
                if (!alive())
                    return;
                p.char.remove_all_transitions();
                p.char.ease({scale_x: 1.15, scale_y: 0.88, duration: 120, mode: M.EASE_OUT_QUAD});
                this._say(pick(['Halo yang di luar layar! 👋', 'Aku nempel di kaca 😆', 'Bang, keluarin aku dari sini! 🥺']));
                let n = 0;
                const knock = () => {
                    if (!alive())
                        return;
                    p.armR.remove_all_transitions();
                    p.armR.ease({rotation_angle_z: -60, duration: 100,
                        onComplete: () => p.armR.ease({rotation_angle_z: -20, duration: 100})});
                    this._floatLabel('tok', 'ngoding-count', rand(10, 14) * U, rand(1, 4) * U,
                        {dy: -20, duration: 500});
                    if (++n < 4) {
                        this._later(320, knock);
                    } else {
                        this._later(900, () => {
                            if (!alive())
                                return;
                            this._actor.ease({scale_x: 1, scale_y: 1, duration: 400, mode: M.EASE_OUT_BACK,
                                onComplete: () => alive() && this._endScene()});
                        });
                    }
                };
                this._later(600, knock);
            }});
    }

    _checkEdges() {
        const b = this._bounds();
        const [x, y] = this._actor.get_position();
        const near = 1.5 * U;
        if (x - b.minX < near && !this._hasNeighbor(-1))
            this._edgeWall(-1);
        else if (b.maxX - x < near && !this._hasNeighbor(1))
            this._edgeWall(1);
        else if (b.maxY - y < near)
            this._edgeBottom();
        else if (y - b.minY < near)
            this._edgeTop();
    }

    _edgeWall(side) {
        const alive = this._startScene();
        const p = this._p;
        const variant = rand(0, 3);
        const arm = side > 0 ? p.armR : p.armL;
        arm.remove_all_transitions();
        if (variant === 0) {
            // nyender ke dinding
            this._say(pick(['Capek, nyender dulu 😮‍💨', 'Tembok ini adem 🧱']));
            p.bounce.ease({rotation_angle_z: 12 * side, duration: 400, mode: M.EASE_OUT_QUAD});
            arm.ease({rotation_angle_z: side > 0 ? 40 : -40, duration: 400});
            this._setFace('sleepy');
            this._later(2800, () => alive() && this._endScene());
        } else if (variant === 1) {
            // mengintip keluar layar
            this._say(pick(['Ada apa ya di balik layar? 👀', 'Halo dunia luar? 🌍']));
            p.eyes.ease({translation_x: 0.8 * U * side, duration: 300});
            p.bounce.ease({rotation_angle_z: 20 * side, translation_x: 2 * U * side, duration: 600,
                mode: M.EASE_IN_OUT_SINE});
            this._later(2000, () => {
                if (!alive())
                    return;
                p.bounce.ease({rotation_angle_z: 0, translation_x: 0, duration: 400});
                this._say(pick(['Ternyata gak ada apa-apa 😅', 'Gelap di sana 😨']));
                this._later(1200, () => alive() && this._endScene());
            });
        } else {
            // dorong tembok
            this._say('Tembok ini kuat banget 💪🧱');
            this._setFace('angry');
            p.armL.remove_all_transitions();
            p.armR.remove_all_transitions();
            let n = 0;
            const push = () => {
                if (!alive())
                    return;
                p.bounce.ease({translation_x: (n % 2 ? 3 : 7) * side, rotation_angle_z: 8 * side,
                    duration: 160, onComplete: () => (++n < 12 ? push() : this._endScene())});
            };
            push();
        }
    }

    _edgeBottom() {
        const alive = this._startScene();
        const p = this._p;
        const variant = rand(0, 3);
        if (variant === 0) {
            // trampolin di dock
            this._say(pick(['Dock-nya empuk! Boing boing 🤸', 'Trampolin gratis! 🎪']));
            this._setFace('happy');
            let n = 0;
            const boing = () => {
                if (!alive())
                    return;
                n++;
                if (n === 3 && chance(2)) {
                    this._salto(() => alive() && this._endScene());
                    return;
                }
                this._hop(n * 1.8 * U, () => (n < 3 ? boing() : this._endScene()));
            };
            boing();
        } else if (variant === 1) {
            // rebahan
            this._say(pick(['Rebahan dulu deket dock 😌', 'Lantai ini enak buat tidur 😴']));
            this._setFace('sleepy');
            this._stopFloat();
            const side = chance(2) ? 1 : -1;
            p.bounce.set_pivot_point(0.5, 1.0);
            p.bounce.ease({rotation_angle_z: 80 * side, translation_y: 0.5 * U, duration: 500,
                mode: M.EASE_OUT_BOUNCE});
            for (let i = 0; i < 4; i++) {
                this._later(800 + i * 700, () => alive() && this._floatLabel(i % 2 ? 'z' : 'Z',
                    'ngoding-z', 8 * U, 2 * U, {dx: 20, dy: -50, duration: 1400}));
            }
            this._later(4000, () => {
                if (!alive())
                    return;
                p.bounce.ease({rotation_angle_z: 0, translation_y: 0, duration: 400, mode: M.EASE_OUT_BACK,
                    onComplete: () => alive() && this._endScene()});
            });
        } else {
            // ketuk-ketuk dock
            this._say(pick(['Tok tok, ada orang di dock? 👋', 'Halo aplikasi-aplikasi! 👋']));
            let n = 0;
            const knock = () => {
                if (!alive())
                    return;
                p.armR.remove_all_transitions();
                p.armR.ease({rotation_angle_z: 60, duration: 110, mode: M.EASE_OUT_QUAD,
                    onComplete: () => p.armR.ease({rotation_angle_z: 20, duration: 110,
                        onComplete: () => (++n < 4 ? knock() : this._endScene())})});
            };
            knock();
        }
    }

    _edgeTop() {
        const alive = this._startScene();
        this._hang(alive);
    }

    _hang(alive) {
        // Bergelantungan di bawah top bar, kadang merayap ke samping (monkey bar)
        const p = this._p;
        this._actor.ease({y: this._bounds().minY, duration: 200});
        this._stopFloat();
        p.bounce.remove_all_transitions();
        p.bounce.set({rotation_angle_z: 0, translation_x: 0, translation_y: 0});
        p.bounce.set_pivot_point(0.5, 0.36);
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        p.armL.ease({rotation_angle_z: 90, duration: 200, mode: M.EASE_OUT_BACK});
        p.armR.ease({rotation_angle_z: -90, duration: 200, mode: M.EASE_OUT_BACK});
        p.legs.forEach(leg => leg.remove_all_transitions());
        this._setFace('happy');
        this._say(pick(['Gelantungan di top bar! 🐒', 'Liat, aku bisa manjat! 🧗', 'Wiii, tinggi! 🎢']));
        this._loop(p.bounce, {rotation_angle_z: 10}, 800);
        p.legs.forEach((leg, i) => this._loop(leg, {rotation_angle_z: i % 2 ? 25 : -25}, 300));

        const drop = () => {
            if (!alive())
                return;
            p.bounce.remove_all_transitions();
            p.bounce.set({rotation_angle_z: 0});
            p.bounce.set_pivot_point(0.5, 1.0);
            this._setFace('dizzy');
            this._say(pick(['Aaa jatuh! 😱', 'Lepas~ 🪂', 'Terjun! 🪂']));
            const wa = this._workArea();
            const ty = clamp(this._actor.y + rand(6 * U, 16 * U), wa.y, this._bounds().maxY);
            const dropX = this._actor.x;
            this._actor.ease({
                x: dropX, y: ty, duration: 420, mode: M.EASE_IN_QUAD,
                onComplete: () => {
                    if (!alive())
                        return;
                    this._savePosition();
                    this._armsIdle();
                    if (chance(3)) {
                        this._salto(() => {
                            this._say(pick(['Mendarat sempurna! 🏅', 'Nilai 10! ✨']));
                            this._endScene();
                        });
                    } else {
                        this._land(() => {
                            this._say(pick(['Hup! Mendarat 😎', 'Aman, gak lecet 👍']));
                            this._endScene();
                        });
                    }
                },
            });
        };

        const traverse = () => {
            if (!alive())
                return;
            const b = this._bounds();
            const x0 = this._actor.x;
            let tx = rand(b.minX, b.maxX);
            if (Math.abs(tx - x0) < 15 * U)
                tx = clamp(x0 + (chance(2) ? 1 : -1) * rand(15 * U, 35 * U), b.minX, b.maxX);
            const dir = tx >= x0 ? 1 : -1;
            this._say(pick(['Monkey bar! 🐒', 'Merayap~ 🦥', 'Satu, dua, satu, dua 💪']));
            p.eyes.ease({translation_x: 0.6 * U * dir, duration: 200});
            // tangan bergantian (tangan di atas kepala)
            p.armL.remove_all_transitions();
            p.armR.remove_all_transitions();
            p.armL.rotation_angle_z = 70;
            p.armR.rotation_angle_z = -110;
            this._loop(p.armL, {rotation_angle_z: 110}, 280);
            this._loop(p.armR, {rotation_angle_z: -70}, 280);
            this._actor.ease({
                x: tx,
                duration: Math.max(600, Math.abs(tx - x0) / 110 * 1000),
                mode: M.LINEAR,
                onComplete: () => {
                    if (!alive())
                        return;
                    p.eyes.ease({translation_x: 0, duration: 200});
                    p.armL.remove_all_transitions();
                    p.armR.remove_all_transitions();
                    p.armL.ease({rotation_angle_z: 90, duration: 150});
                    p.armR.ease({rotation_angle_z: -90, duration: 150});
                    this._later(rand(1200, 2500), drop);
                },
            });
        };

        if (chance(2)) {
            this._later(2000, () => {
                if (!alive())
                    return;
                this._say('Pull-up! 💪');
                let n = 0;
                const up = () => {
                    if (!alive())
                        return;
                    p.float.ease({translation_y: -U, duration: 260, mode: M.EASE_OUT_QUAD,
                        onComplete: () => p.float.ease({translation_y: 0, duration: 260,
                            onComplete: () => {
                                if (++n < 3)
                                    up();
                                else if (alive())
                                    this._later(500, chance(3) ? drop : traverse);
                            }})});
                };
                up();
            });
        } else {
            this._later(rand(1500, 2500), () => (chance(4) ? drop() : traverse()));
        }
    }

    // --- adegan bermain ----------------------------------------------------

    _prop(params, x, y) {
        // params: aktor jadi (mis. dari shape()) atau properti St.Widget
        const w = params instanceof Clutter.Actor ? params : new St.Widget(params);
        w.set_position(Math.round(x), Math.round(y));
        this._p.float.add_child(w);
        this._props.add(w);
        w.connect('destroy', () => this._props?.delete(w));
        return w;
    }

    _propLabel(text, styleClass, x, y) {
        const l = new St.Label({text, style_class: styleClass});
        l.set_position(Math.round(x), Math.round(y));
        this._p.float.add_child(l);
        this._props.add(l);
        l.connect('destroy', () => this._props?.delete(l));
        return l;
    }

    _floatLabel(text, styleClass, x, y, {dx = 0, dy = -70, duration = 1300, style = ''} = {}) {
        const l = this._propLabel(text, styleClass, x, y);
        if (style)
            l.style = style;
        l.ease({
            translation_x: dx,
            translation_y: dy,
            opacity: 0,
            duration,
            mode: M.EASE_OUT_QUAD,
            onComplete: () => l.destroy(),
        });
        return l;
    }

    _endScene() {
        for (const w of [...this._props])
            w.destroy();
        this._props.clear();
        this._busy = false;
        this._sceneToken = null;
        this._stackAbove = null;
        if (this._p) {
            this._resetPose();
            const s = this._actor.hover ? 1.08 : 1;
            this._actor.ease({scale_x: 1, scale_y: 1, duration: 200, mode: M.EASE_OUT_QUAD});
            this._p.body.ease({scale_x: s, scale_y: s, duration: 200, mode: M.EASE_OUT_QUAD});
            this._snapInside();
            this._restack();
        }
    }

    _startScene() {
        this._busy = true;
        const token = {};
        this._sceneToken = token;
        return () => this._p && this._sceneToken === token;
    }

    _interrupt() {
        // Hentikan semua yang sedang berjalan (dipanggil saat klik/drag)
        if (this._moving)
            this._stopRun();
        if (this._sceneToken || this._busy)
            this._endScene();
        this._actor.remove_transition('x');
        this._actor.remove_transition('y');
        const [x, y] = this._actor.get_position();
        this._moveTo(x, y);
    }

    _sceneBall() {
        const alive = this._startScene();
        const p = this._p;
        const ballSize = Math.round(2.2 * U);
        const ball = this._prop(shape(ballSize, ballSize, TOY.ball), CHAR_W / 2 - ballSize / 2, -140);
        ball.set_pivot_point(0.5, 0.5);
        ball.opacity = 0;
        this._say(pick(['Liat nih, aku jago juggling! ⚽', 'Main bola yuk! ⚽']));
        this._setFace('happy');

        const headY = -2;
        const kick = () => {
            const dir = chance(2) ? 1 : -1;
            p.bounce.ease({rotation_angle_z: 12 * dir, duration: 120, mode: M.EASE_OUT_QUAD,
                onComplete: () => p.bounce.ease({rotation_angle_z: 0, duration: 200, mode: M.EASE_OUT_BACK})});
            ball.ease({
                translation_x: 30 * U * dir,
                translation_y: -160,
                rotation_angle_z: 720 * dir,
                opacity: 0,
                duration: 800,
                mode: M.EASE_OUT_QUAD,
                onComplete: () => {
                    if (alive()) {
                        this._say(pick(['Gooolll!! ⚽🎉', 'Tendangan maut! 💥', 'Waduh, kejauhan 😅']));
                        this._later(600, () => alive() && this._endScene());
                    }
                },
            });
        };
        const juggle = n => {
            if (!alive())
                return;
            if (n <= 0) {
                kick();
                return;
            }
            p.bounce.ease({
                translation_y: -U,
                duration: 110,
                mode: M.EASE_OUT_QUAD,
                onComplete: () => p.bounce.ease({translation_y: 0, duration: 140, mode: M.EASE_IN_QUAD}),
            });
            ball.ease({
                translation_y: 140 + headY - rand(9 * U, 14 * U),
                rotation_angle_z: ball.rotation_angle_z + 180,
                duration: 320,
                mode: M.EASE_OUT_QUAD,
                onComplete: () => ball.ease({
                    translation_y: 140 + headY,
                    rotation_angle_z: ball.rotation_angle_z + 180,
                    duration: 320,
                    mode: M.EASE_IN_QUAD,
                    onComplete: () => juggle(n - 1),
                }),
            });
        };
        ball.ease({opacity: 255, translation_y: 140 + headY, duration: 420, mode: M.EASE_IN_QUAD,
            onComplete: () => juggle(5)});
    }

    _sceneYoyo() {
        const alive = this._startScene();
        const p = this._p;
        const hx = 15 * U;
        const hy = 6 * U;
        const yoyoSize = 2 * U;
        const string = this._prop({style_class: 'ngoding-string', width: 2, height: 1}, hx, hy);
        const yoyo = this._prop(shape(yoyoSize, yoyoSize, TOY.yoyo), hx - yoyoSize / 2 + 1, hy - yoyoSize / 2);
        yoyo.set_pivot_point(0.5, 0.5);
        p.armR.remove_all_transitions();
        p.armR.ease({rotation_angle_z: 15, duration: 150, mode: M.EASE_OUT_QUAD});
        this._say(pick(['Main yo-yo dulu~ 🪀', 'Liat trik yo-yo aku! 🪀']));

        const drop = 8 * U;
        const cycle = n => {
            if (!alive())
                return;
            if (n <= 0) {
                string.ease({opacity: 0, duration: 250});
                yoyo.ease({opacity: 0, scale_x: 0.3, scale_y: 0.3, duration: 250,
                    onComplete: () => alive() && this._endScene()});
                return;
            }
            string.ease({height: drop, duration: 380, mode: M.EASE_IN_QUAD});
            p.armR.ease({rotation_angle_z: 30, duration: 380, mode: M.EASE_IN_QUAD});
            yoyo.ease({
                translation_y: drop,
                rotation_angle_z: yoyo.rotation_angle_z + 540,
                duration: 380,
                mode: M.EASE_IN_QUAD,
                onComplete: () => {
                    if (!alive())
                        return;
                    string.ease({height: 1, duration: 380, mode: M.EASE_OUT_QUAD});
                    p.armR.ease({rotation_angle_z: -10, duration: 200, mode: M.EASE_OUT_QUAD});
                    yoyo.ease({
                        translation_y: 0,
                        rotation_angle_z: yoyo.rotation_angle_z + 540,
                        duration: 380,
                        mode: M.EASE_OUT_QUAD,
                        onComplete: () => cycle(n - 1),
                    });
                },
            });
        };
        this._later(300, () => cycle(4));
    }

    _sceneBubbles() {
        const alive = this._startScene();
        this._setFace('blow');
        this._say(pick(['Tiup gelembung~ 🫧', 'Fuuuh~ 🫧']));
        const count = 7;
        for (let i = 0; i < count; i++) {
            this._later(300 + i * 280, () => {
                if (!alive())
                    return;
                const size = rand(1.3 * U, 2.8 * U);
                const b = this._prop(shape(size, size, TOY.soap), 8 * U - size / 2, 6.5 * U - size / 2);
                b.set_pivot_point(0.5, 0.5);
                b.set({scale_x: 0.2, scale_y: 0.2, opacity: 230});
                b.ease({
                    scale_x: 1,
                    scale_y: 1,
                    translation_x: rand(-90, 90),
                    translation_y: -rand(80, 160),
                    duration: rand(1400, 2200),
                    mode: M.EASE_OUT_SINE,
                    onComplete: () => b.ease({
                        opacity: 0,
                        scale_x: 1.4,
                        scale_y: 1.4,
                        duration: 160,
                        onComplete: () => b.destroy(),
                    }),
                });
            });
        }
        this._later(300 + count * 280 + 2400, () => {
            if (alive()) {
                this._say(pick(['Cantik ya gelembungnya ✨', 'Pop! pop! 🫧']));
                this._endScene();
            }
        });
    }

    _sceneCode() {
        const alive = this._startScene();
        const p = this._p;
        const laptop = this._prop({width: 7 * U, height: 4 * U}, 4.5 * U, 5 * U);
        const screen = shape(7 * U, 3.2 * U, TOY.laptopScreen);
        const base = shape(8 * U, 0.8 * U, TOY.laptopBase);
        base.set_position(-0.5 * U, 3.2 * U);
        laptop.add_child(screen);
        laptop.add_child(base);
        const lines = [];
        for (let i = 0; i < 3; i++) {
            const line = new St.Widget({style_class: 'ngoding-code-line', width: 1, height: Math.round(0.35 * U)});
            line.set_position(Math.round(0.7 * U), Math.round(0.7 * U + i * 0.8 * U));
            screen.add_child(line);
            lines.push(line);
        }
        laptop.set_pivot_point(0.5, 1.0);
        laptop.set({opacity: 0, scale_y: 0.2});
        laptop.ease({opacity: 255, scale_y: 1, duration: 260, mode: M.EASE_OUT_BACK});

        this._say(pick(['Lagi ngoding... jangan diganggu 🤓', 'Bentar, lagi fix bug 🐛', 'Push ke production nih 🚀']));
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();

        let t = 0;
        const glyphs = ['{ }', '</>', ';', '=>', '()', '#!', '[]'];
        const finish = () => {
            this._setFace('happy');
            this._say(pick(['Done! Build sukses ✅', 'Kelar! Tinggal review 🎉', 'Bug-nya kabur 🏃']));
            laptop.ease({opacity: 0, scale_y: 0.2, duration: 220,
                onComplete: () => this._later(800, () => alive() && this._endScene())});
        };
        const type = () => {
            if (!alive())
                return;
            t++;
            p.armL.ease({rotation_angle_z: t % 2 ? 25 : 5, duration: 110, mode: M.EASE_OUT_QUAD});
            p.armR.ease({rotation_angle_z: t % 2 ? -5 : -25, duration: 110, mode: M.EASE_OUT_QUAD});
            const line = lines[t % 3];
            line.width = Math.min(6 * U - 12, line.width + rand(4, 10));
            if (line.width >= 6 * U - 12)
                line.width = 1;
            if (t % 4 === 0)
                this._floatLabel(pick(glyphs), 'ngoding-glyph', rand(2, 12) * U, 2 * U);
            if (t < 26)
                this._later(140, type);
            else
                finish();
        };
        this._later(300, type);
    }

    _sceneSleep() {
        const alive = this._startScene();
        this._setFace('sleepy');
        this._say('Ngantuk... tidur bentar ya 😴');
        this._p.char.remove_all_transitions();
        this._p.char.ease({scale_y: 0.92, duration: 600, mode: M.EASE_IN_OUT_SINE});
        let n = 0;
        const z = () => {
            if (!alive())
                return;
            this._floatLabel(n % 3 === 2 ? 'Z' : 'z', 'ngoding-z', 12 * U, U,
                {dx: rand(10, 30), dy: -60, duration: 1600});
            n++;
            if (n < 9) {
                this._later(700, z);
            } else {
                this._later(1200, () => {
                    if (alive()) {
                        this._say('Hah! Aku gak tidur kok 😳');
                        this._endScene();
                    }
                });
            }
        };
        this._later(600, z);
    }

    _sceneGuitar() {
        const alive = this._startScene();
        const p = this._p;
        const guitar = this._prop({width: 8 * U, height: 3 * U}, 1.5 * U, 5 * U);
        const body = shape(3.4 * U, 2.8 * U, TOY.guitarBody);
        const hole = shape(U, U, TOY.guitarHole);
        hole.set_position(1.2 * U, 0.9 * U);
        body.add_child(hole);
        const neck = shape(4.2 * U, 0.55 * U, TOY.guitarNeck);
        neck.set_position(3.2 * U, 1.1 * U);
        const head = shape(U, 1.1 * U, TOY.guitarNeck);
        head.set_position(7.2 * U, 0.8 * U);
        guitar.add_child(neck);
        guitar.add_child(head);
        guitar.add_child(body);
        guitar.set_pivot_point(0.3, 0.5);
        guitar.set({rotation_angle_z: -18, opacity: 0, scale_x: 0.3, scale_y: 0.3});
        guitar.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 260, mode: M.EASE_OUT_BACK});

        this._setFace('happy');
        this._say(pick(['Jreng jreng~ 🎸', 'Request lagu dong bang 🎶', 'Aku anak band sekarang 🤘']));
        p.armR.remove_all_transitions();

        const colors = ['#FFE27A', '#7CE38B', '#7FC8FF', '#FF9BD2'];
        let n = 0;
        const strum = () => {
            if (!alive())
                return;
            n++;
            p.armR.ease({rotation_angle_z: n % 2 ? 25 : -15, duration: 150, mode: M.EASE_IN_OUT_QUAD});
            p.bounce.ease({rotation_angle_z: n % 4 < 2 ? -4 : 4, duration: 300, mode: M.EASE_IN_OUT_SINE});
            if (n % 2 === 0) {
                this._floatLabel(pick(['♪', '♫', '♬', '♩']), 'ngoding-note',
                    rand(2, 13) * U, 2 * U,
                    {dx: rand(-30, 30), dy: -rand(60, 100), duration: 1500,
                        style: `color: ${pick(colors)};`});
            }
            if (n < 22) {
                this._later(160, strum);
            } else {
                this._say(pick(['Makasih penontonnya! 🙇', 'Encore? 👏']));
                guitar.ease({opacity: 0, scale_x: 0.3, scale_y: 0.3, duration: 220,
                    onComplete: () => this._later(600, () => alive() && this._endScene())});
            }
        };
        this._later(300, strum);
    }

    _sceneCoffee() {
        const alive = this._startScene();
        const p = this._p;
        const mug = this._prop({width: 3 * U, height: 2.6 * U}, 13.5 * U, 4.5 * U);
        const cup = shape(2.2 * U, 2.4 * U, TOY.mug);
        const coffee = shape(1.6 * U, 0.4 * U, TOY.coffee);
        coffee.set_position(Math.round(0.3 * U), Math.round(0.25 * U));
        cup.add_child(coffee);
        const handle = shape(0.8 * U, 1.2 * U, TOY.mugHandle);
        handle.set_position(Math.round(2 * U), Math.round(0.5 * U));
        mug.add_child(handle);
        mug.add_child(cup);
        mug.set_pivot_point(0.5, 1.0);
        mug.set({opacity: 0, scale_x: 0.3, scale_y: 0.3});
        mug.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 260, mode: M.EASE_OUT_BACK});
        this._say(pick(['Ngopi dulu biar melek ☕', 'Kopi adalah bahan bakar coding ☕']));

        const steam = () => {
            if (!alive())
                return;
            const [mx, my] = mug.get_position();
            this._floatLabel('~', 'ngoding-steam',
                mx + mug.translation_x + rand(2, 14), my + mug.translation_y - 10,
                {dx: rand(-8, 8), dy: -40, duration: 1100});
            this._steamId = this._later(260, steam);
        };
        steam();

        p.armR.remove_all_transitions();
        this._later(700, () => {
            if (!alive())
                return;
            p.armR.ease({rotation_angle_z: -40, duration: 300, mode: M.EASE_OUT_QUAD});
            mug.ease({
                translation_x: -4.5 * U,
                translation_y: -1.2 * U,
                rotation_angle_z: -25,
                duration: 450,
                mode: M.EASE_IN_OUT_QUAD,
                onComplete: () => {
                    if (!alive())
                        return;
                    this._setFace('happy');
                    this._later(1300, () => {
                        if (!alive())
                            return;
                        this._say(pick(['Ahh~ nikmat ☕😌', 'Seger! Siap ngoding lagi 💪']));
                        mug.ease({translation_x: 0, translation_y: 0, rotation_angle_z: 0,
                            duration: 400, mode: M.EASE_IN_OUT_QUAD});
                        this._later(1400, () => {
                            if (!alive())
                                return;
                            this._cancel(this._steamId);
                            mug.ease({opacity: 0, scale_x: 0.3, scale_y: 0.3, duration: 220,
                                onComplete: () => alive() && this._endScene()});
                        });
                    });
                },
            });
        });
    }

    _scenePlane() {
        const alive = this._startScene();
        const p = this._p;
        const dir = chance(2) ? 1 : -1;
        const plane = this._propLabel('✈️', 'ngoding-plane',
            dir > 0 ? 14 * U : -1 * U, 3 * U);
        plane.set_pivot_point(0.5, 0.5);
        plane.set({opacity: 0, scale_x: dir, rotation_angle_z: -15 * dir});
        plane.ease({opacity: 255, duration: 200});
        this._say(pick(['Bikin pesawat kertas~ ✈️', 'Siap lepas landas! 🛫']));

        const arm = dir > 0 ? p.armR : p.armL;
        arm.remove_all_transitions();
        arm.ease({
            rotation_angle_z: dir > 0 ? 40 : -40,
            duration: 300,
            mode: M.EASE_OUT_QUAD,
            onComplete: () => {
                if (!alive())
                    return;
                arm.ease({rotation_angle_z: dir > 0 ? -80 : 80, duration: 140, mode: M.EASE_IN_QUAD});
                p.eyes.ease({translation_x: 0.75 * U * dir, duration: 300});
                plane.ease({
                    translation_x: 22 * U * dir,
                    translation_y: -10 * U,
                    rotation_angle_z: -25 * dir,
                    duration: 900,
                    mode: M.EASE_OUT_QUAD,
                    onComplete: () => plane.ease({
                        translation_x: 40 * U * dir,
                        translation_y: -4 * U,
                        rotation_angle_z: 10 * dir,
                        opacity: 0,
                        duration: 900,
                        mode: M.EASE_IN_OUT_SINE,
                        onComplete: () => {
                            if (!alive())
                                return;
                            this._setFace('happy');
                            this._say(pick(['Wuuush~ jauh banget! 🌤️', 'Sampai ke Jakarta kayaknya 😆']));
                            this._later(1200, () => alive() && this._endScene());
                        },
                    }),
                });
            },
        });
    }

    _sceneJumpRope() {
        const alive = this._startScene();
        const p = this._p;
        const rope = this._prop(shape(CHAR_W + 2 * U, CHAR_H + 2 * U, TOY.rope), -U, -1.5 * U);
        rope.set_pivot_point(0.5, 0.5);
        rope.opacity = 0;
        rope.ease({opacity: 255, duration: 200});
        this._say(pick(['Lompat tali! Hitung ya bang 🔢', 'Olahraga dulu biar sehat 🏃']));
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        p.armL.ease({rotation_angle_z: -20, duration: 200});
        p.armR.ease({rotation_angle_z: 20, duration: 200});

        let jumps = 0;
        const total = 7;
        const turn = () => {
            if (!alive())
                return;
            rope.rotation_angle_x = 0;
            rope.ease({rotation_angle_x: 360, duration: 620, mode: M.LINEAR});
            this._later(200, () => {
                if (!alive())
                    return;
                p.bounce.ease({
                    translation_y: -2.6 * U,
                    duration: 160,
                    mode: M.EASE_OUT_QUAD,
                    onComplete: () => p.bounce.ease({translation_y: 0, duration: 160, mode: M.EASE_IN_QUAD}),
                });
            });
            jumps++;
            if (jumps % 2 === 0 && chance(2))
                this._floatLabel(`${jumps}!`, 'ngoding-count', 12 * U, 0, {dy: -40, duration: 700});
            if (jumps < total) {
                this._later(620, turn);
            } else {
                this._later(650, () => {
                    if (!alive())
                        return;
                    rope.ease({opacity: 0, duration: 200});
                    this._setFace('happy');
                    this._say(pick([`${total} kali! Capek juga 😮‍💨`, 'Fiuh, keringetan 💦']));
                    this._later(1000, () => alive() && this._endScene());
                });
            }
        };
        this._later(300, turn);
    }

    _sceneBalloon() {
        const alive = this._startScene();
        const p = this._p;
        const size = Math.round(3.2 * U);
        const balloon = this._prop({width: size, height: 9 * U}, -2.4 * U, -4.5 * U);
        const string = shape(2, 5.5 * U, TOY.string);
        string.set_position(Math.round(size / 2), size);
        const ball = shape(size, size * 1.15, TOY.balloon);
        const shine = shape(0.7 * U, 0.9 * U, TOY.shine);
        shine.set_position(Math.round(0.6 * U), Math.round(0.6 * U));
        ball.add_child(shine);
        balloon.add_child(string);
        balloon.add_child(ball);
        balloon.set_pivot_point(0.5, 1.0);
        balloon.set({opacity: 0, scale_x: 0.2, scale_y: 0.2});
        balloon.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 400, mode: M.EASE_OUT_BACK});
        this._loop(balloon, {rotation_angle_z: 8, translation_y: -6}, 700);
        this._setFace('happy');
        this._say(pick(['Aku punya balon! 🎈', 'Balonku ada satu~ 🎈🎶']));

        this._later(3500, () => {
            if (!alive())
                return;
            balloon.remove_all_transitions();
            ball.set_pivot_point(0.5, 0.5);
            ball.ease({scale_x: 1.4, scale_y: 1.4, opacity: 0, duration: 120, mode: M.EASE_OUT_QUAD});
            string.ease({opacity: 0, translation_y: 2 * U, duration: 400});
            const [bx, by] = balloon.get_position();
            this._floatLabel('💥', 'ngoding-pop', bx - 4, by - 6, {dy: -10, duration: 600});
            this._setFace('dizzy');
            p.bounce.ease({
                translation_y: -2 * U,
                duration: 120,
                mode: M.EASE_OUT_QUAD,
                onComplete: () => p.bounce.ease({translation_y: 0, duration: 260, mode: M.EASE_OUT_BOUNCE}),
            });
            this._say(pick(['DOR! Kaget aku 😱', 'Yaaah balonku meletus 😭']));
            this._later(1800, () => alive() && this._endScene());
        });
    }

    _sceneSkate() {
        const alive = this._startScene();
        const p = this._p;
        const board = this._prop({width: 13 * U, height: 2 * U}, 1.5 * U, 9.6 * U);
        const deck = shape(13 * U, 0.7 * U, TOY.skate);
        board.add_child(deck);
        for (const wx of [1.5, 10.5]) {
            const wheel = shape(U, U, TOY.wheel);
            wheel.set_position(Math.round(wx * U), Math.round(0.6 * U));
            board.add_child(wheel);
        }
        board.opacity = 0;
        board.ease({opacity: 255, duration: 200});
        this._setFace('happy');
        this._say(pick(['Skateboard time! 🛹', 'Minggir-minggir~ 🛹']));
        this._stopFloat();
        p.bounce.ease({translation_y: -0.6 * U, duration: 150});

        const b = this._bounds();
        const [x0] = this._actor.get_position();
        const dir = x0 + 30 * U < b.maxX ? 1 : -1;
        const x1 = clamp(x0 + dir * 30 * U, b.minX, b.maxX);
        const ollie = () => {
            if (!alive())
                return;
            board.ease({translation_y: -2 * U, rotation_angle_z: -10 * dir, duration: 180, mode: M.EASE_OUT_QUAD,
                onComplete: () => board.ease({translation_y: 0, rotation_angle_z: 0, duration: 180, mode: M.EASE_IN_QUAD})});
            p.bounce.ease({translation_y: -2.6 * U, duration: 180, mode: M.EASE_OUT_QUAD,
                onComplete: () => p.bounce.ease({translation_y: -0.6 * U, duration: 180, mode: M.EASE_IN_QUAD})});
        };
        p.bounce.ease({rotation_angle_z: 6 * dir, duration: 200});
        this._actor.ease({
            x: x1, duration: 1600, mode: M.EASE_IN_OUT_SINE,
            onComplete: () => {
                if (!alive())
                    return;
                ollie();
                this._say(pick(['Ollie! 🤙', 'Kickflip! ✨']));
                p.bounce.ease({rotation_angle_z: -6 * dir, duration: 200});
                this._later(500, () => {
                    if (!alive())
                        return;
                    this._actor.ease({
                        x: x0, duration: 1600, mode: M.EASE_IN_OUT_SINE,
                        onComplete: () => {
                            if (!alive())
                                return;
                            this._savePosition();
                            board.ease({opacity: 0, duration: 200,
                                onComplete: () => alive() && this._endScene()});
                        },
                    });
                });
            },
        });
        this._later(800, ollie);
    }

    _sceneBook() {
        const alive = this._startScene();
        const p = this._p;
        const book = this._prop({width: 8 * U, height: 3.6 * U}, 4 * U, 5.2 * U);
        const cover = shape(8.4 * U, 3.6 * U, TOY.bookCover);
        cover.set_position(Math.round(-0.2 * U), 0);
        const left = shape(4 * U, 3.2 * U, TOY.page);
        const right = shape(4 * U, 3.2 * U, TOY.page);
        right.set_position(4 * U, 0);
        book.add_child(cover);
        book.add_child(left);
        book.add_child(right);
        for (const pg of [left, right]) {
            for (let i = 0; i < 3; i++)
                px(pg, 0.5, 0.6 + i * 0.7, 3, 0.25, 'rgba(43,34,48,0.35)');
        }
        book.set_pivot_point(0.5, 1.0);
        book.set({opacity: 0, scale_y: 0.3});
        book.ease({opacity: 255, scale_y: 1, duration: 250, mode: M.EASE_OUT_BACK});
        this._say(pick(['Baca dokumentasi dulu 📖', 'RTFM, kata senior 📚', 'Bab 3: Kenapa bug selalu ada 📖']));
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        p.armL.ease({rotation_angle_z: 30, duration: 200});
        p.armR.ease({rotation_angle_z: -30, duration: 200});

        let n = 0;
        const read = () => {
            if (!alive())
                return;
            p.eyes.ease({translation_x: -0.5 * U, duration: 200,
                onComplete: () => p.eyes.ease({translation_x: 0.5 * U, duration: 900, mode: M.LINEAR})});
            this._later(1200, () => {
                if (!alive())
                    return;
                const flip = shape(4 * U, 3.2 * U, TOY.page);
                flip.set_position(4 * U, 0);
                flip.set_pivot_point(0, 0.5);
                book.add_child(flip);
                flip.ease({rotation_angle_y: -180, duration: 450, mode: M.EASE_IN_OUT_QUAD,
                    onComplete: () => flip.destroy()});
                if (++n < 3) {
                    this._later(500, read);
                } else {
                    this._later(700, () => {
                        if (!alive())
                            return;
                        this._setFace('happy');
                        this._say(pick(['Oh gitu caranya! 💡', 'Ilmu baru! 🧠✨']));
                        book.ease({opacity: 0, scale_y: 0.3, duration: 220,
                            onComplete: () => this._later(700, () => alive() && this._endScene())});
                    });
                }
            });
        };
        this._later(300, read);
    }

    _sceneMagic() {
        const alive = this._startScene();
        const p = this._p;
        const wand = this._prop({width: 4 * U, height: 2 * U}, 14.5 * U, 3 * U);
        const stick = shape(3.4 * U, 0.35 * U, TOY.wand);
        stick.set_position(0, Math.round(0.8 * U));
        const tip = new St.Label({text: '⭐', style_class: 'ngoding-star'});
        tip.set_position(Math.round(3 * U), 0);
        wand.add_child(stick);
        wand.add_child(tip);
        wand.set_pivot_point(0, 0.5);
        wand.rotation_angle_z = -30;
        this._say(pick(['Abrakadabra! 🪄', 'Sim salabim~ ✨']));
        p.armR.remove_all_transitions();
        let n = 0;
        const swish = () => {
            if (!alive())
                return;
            n++;
            wand.ease({rotation_angle_z: n % 2 ? -70 : -10, duration: 200, mode: M.EASE_IN_OUT_QUAD});
            p.armR.ease({rotation_angle_z: n % 2 ? -50 : -10, duration: 200});
            for (let i = 0; i < 3; i++) {
                this._floatLabel(pick(['✨', '⭐', '💫']), 'ngoding-sparkle',
                    rand(12, 20) * U, rand(-2, 4) * U,
                    {dx: rand(-40, 40), dy: -rand(20, 60), duration: 800});
            }
            if (n < 6) {
                this._later(220, swish);
                return;
            }
            const prize = pick(['🐰', '🕊️', '🌹', '🍩', '🐱']);
            const pop = this._propLabel(prize, 'ngoding-prize', 7 * U, -2 * U);
            pop.set_pivot_point(0.5, 0.5);
            pop.set({scale_x: 0.1, scale_y: 0.1});
            pop.ease({scale_x: 1, scale_y: 1, duration: 300, mode: M.EASE_OUT_BACK});
            this._setFace('happy');
            this._say(prize === '🐰' ? 'Tadaa! Ada kelinci! 🐰' : `Tadaa! Muncul ${prize}!`);
            this._later(1600, () => {
                if (!alive())
                    return;
                pop.ease({translation_y: -40, opacity: 0, duration: 400});
                wand.ease({opacity: 0, duration: 300, onComplete: () => alive() && this._endScene()});
            });
        };
        this._later(300, swish);
    }

    _sceneRubik() {
        const alive = this._startScene();
        const p = this._p;
        const colors = ['#F94144', '#F9C74F', '#43AA8B', '#277DA1', '#FFFFFF', '#F8961E'];
        const cube = this._prop(shape(3 * U, 3 * U, TOY.rubik), 6.5 * U, 5 * U);
        const cells = [];
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++)
                cells.push(px(cube, 0.15 + c * 0.95, 0.15 + r * 0.95, 0.8, 0.8, pick(colors)));
        }
        cube.set_pivot_point(0.5, 0.5);
        cube.set({opacity: 0, scale_x: 0.3, scale_y: 0.3});
        cube.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 250, mode: M.EASE_OUT_BACK});
        this._say(pick(['Rubik! Bisa 10 detik gak ya? 🧩', 'Muter-muter dulu 🧩']));
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        let n = 0;
        const twist = () => {
            if (!alive())
                return;
            n++;
            cube.ease({rotation_angle_z: (n % 2 ? 1 : -1) * 15, duration: 150});
            p.armL.ease({rotation_angle_z: n % 2 ? 30 : 10, duration: 150});
            p.armR.ease({rotation_angle_z: n % 2 ? -10 : -30, duration: 150});
            for (const cell of cells)
                cell.setColor(pick(colors));
            if (n < 16) {
                this._later(180, twist);
                return;
            }
            const win = pick(colors);
            for (const cell of cells)
                cell.setColor(win);
            cube.ease({rotation_angle_z: 0, scale_x: 1.2, scale_y: 1.2, duration: 200, mode: M.EASE_OUT_BACK});
            this._setFace('happy');
            this._say(pick(['Selesai! Rekor baru! 🏆', 'Gampang~ 😎🧩']));
            this._later(1500, () => {
                if (!alive())
                    return;
                cube.ease({opacity: 0, scale_x: 0.3, scale_y: 0.3, duration: 220,
                    onComplete: () => alive() && this._endScene()});
            });
        };
        this._later(300, twist);
    }

    _sceneSelfie() {
        const alive = this._startScene();
        const p = this._p;
        const phone = this._prop(shape(1.8 * U, 3 * U, TOY.phone), 15 * U, U);
        phone.opacity = 0;
        phone.ease({opacity: 255, duration: 200});
        p.armR.remove_all_transitions();
        p.armR.ease({rotation_angle_z: -60, duration: 250});
        this._say(pick(['Selfie dulu ah 📸', 'Senyum~ 1, 2, 3... 📸']));
        this._later(900, () => {
            if (!alive())
                return;
            this._setFace('happy');
            const peace = this._propLabel('✌️', 'ngoding-prize', -1.5 * U, 2 * U);
            peace.set_pivot_point(0.5, 0.5);
            peace.set({scale_x: 0.2, scale_y: 0.2});
            peace.ease({scale_x: 1, scale_y: 1, duration: 200, mode: M.EASE_OUT_BACK});
            p.bounce.ease({rotation_angle_z: -8, duration: 200});
            this._later(500, () => {
                if (!alive())
                    return;
                const flash = this._prop(shape(CHAR_W, CHAR_H, TOY.flash), 0, 0);
                flash.ease({opacity: 0, duration: 400, onComplete: () => flash.destroy()});
                this._say(pick(['Cekrek! 📸 Ganteng kan?', 'Buat story IG 🤳✨']));
                this._later(1500, () => alive() && this._endScene());
            });
        });
    }

    // --- gelembung kata-kata -----------------------------------------------

    _sayNow(text) {
        this._say(text, {urgent: true});
    }

    _say(text, {urgent = false} = {}) {
        if (!this._actor || !text)
            return;
        const now = Date.now();
        const b = this._p.bubble;
        // Kalimat yang baru muncul diberi waktu baca minimal; kalimat berikutnya
        // menunggu sebentar lalu langsung menggantikannya (tanpa menunggu gelembung
        // hilang dulu), supaya ucapan tidak telat dari adegannya.
        if (!urgent && now < (this._speakUntil ?? 0)) {
            if (b.root.visible && b.full === text)
                return;
            this._sayQueue ??= [];
            if (this._sayQueue.length < 2 && !this._sayQueue.some(q => q.text === text))
                this._sayQueue.push({text, t: now});
            if (!this._timeouts.has(this._flushId))
                this._flushId = this._later(this._speakUntil - now + 10, () => this._nextQueued());
            return;
        }
        if (urgent) {
            this._sayQueue = [];
            this._cancel(this._flushId);
        }
        this._cancel(this._bubbleHideId);
        this._cancel(this._typeId);

        // Ukur dengan teks lengkap dulu supaya ukuran gelembung tetap saat mengetik
        b.box.set_size(-1, -1);
        b.text.width = -1;
        b.text.text = text;
        b.full = text;
        const [, natW] = b.text.get_preferred_width(-1);
        if (natW > BUBBLE_MAX_W)
            b.text.width = BUBBLE_MAX_W;
        const [, , boxW, boxH] = b.box.get_preferred_size();
        b.box.set_size(boxW, boxH);

        const [ax, ay] = this._actor.get_position();
        const cx = Math.round(CHAR_W / 2);
        // Dekat atas layar: gelembung di bawah maskot
        const below = ay - boxH - 30 < this._panelBottom();
        const by = below ? ACTOR_H + 16 : -boxH - 18;
        // Jangan terpotong di tepi kiri/kanan layar
        const m = this._monitor();
        const gx = clamp(ax + cx - boxW / 2, m.x + 8, m.x + m.width - boxW - 8);
        const bx = Math.round(gx - ax);
        const tailX = clamp(cx, bx + 16, bx + boxW - 16);
        b.box.set_position(bx, by);
        if (below) {
            b.tailOuter.set_position(tailX - 7, by - 7);
            b.tailInner.set_position(tailX - 5, by - 2);
        } else {
            b.tailOuter.set_position(tailX - 7, by + boxH - 7);
            b.tailInner.set_position(tailX - 5, by + boxH - 8);
        }

        const showing = b.root.visible && b.root.opacity > 0;
        b.root.set_pivot_point(0.5, below ? 0.0 : 1.0);
        b.root.remove_all_transitions();
        if (showing) {
            // Ganti kalimat: cukup "denyut" kecil, gelembung tidak hilang dulu
            b.root.set({opacity: 255, scale_x: 0.94, scale_y: 0.94, translation_y: 0});
            b.root.ease({scale_x: 1, scale_y: 1, duration: 160, mode: M.EASE_OUT_BACK});
        } else {
            b.root.set({visible: true, opacity: 0, scale_x: 0.6, scale_y: 0.6, translation_y: below ? -6 : 6});
            b.root.ease({opacity: 255, duration: 120, mode: M.EASE_OUT_QUAD});
            b.root.ease({
                scale_x: 1,
                scale_y: 1,
                translation_y: 0,
                duration: 220,
                mode: M.EASE_OUT_BACK,
            });
        }

        const chars = Array.from(text);
        // minimal sampai selesai diketik + waktu baca singkat
        this._speakUntil = now + chars.length * TYPE_SPEED + 900 + chars.length * 20;
        // Huruf pertama langsung tampil bersamaan dengan munculnya gelembung
        let n = 0;
        const type = () => {
            n++;
            b.text.text = chars.slice(0, n).join('');
            if (n < chars.length) {
                this._typeId = this._later(TYPE_SPEED, type);
            } else {
                this._bubbleHideId = this._later(1800 + chars.length * 40,
                    () => this._hideBubble());
            }
        };
        type();
    }

    _hideBubble() {
        const root = this._p.bubble.root;
        root.ease({
            opacity: 0,
            scale_x: 0.85,
            scale_y: 0.85,
            duration: 180,
            mode: M.EASE_IN_QUAD,
            onComplete: () => {
                root.visible = false;
                this._nextQueued();
            },
        });
    }

    _nextQueued() {
        this._cancel(this._flushId);
        while (this._sayQueue?.length) {
            const item = this._sayQueue.shift();
            // Kalimat yang sudah terlalu lama menunggu tidak relevan lagi
            if (Date.now() - item.t < 4000) {
                this._say(item.text);
                return;
            }
        }
    }

    // --- interaksi ---------------------------------------------------------

    _touch() {
        this._lastInteraction = Date.now();
    }

    _onHover() {
        if (this._state === 'drag')
            return;
        const hover = this._actor.hover;
        this._state = hover ? 'hover' : 'idle';
        if (hover)
            this._touch();
        if (this._goingAway)
            return;
        if (this._exhausted) {
            this._p.body.ease({scale_x: hover ? 1.05 : 1, scale_y: hover ? 1.05 : 1, duration: 200});
            return;
        }
        if (!this._busy) {
            this._setFace(this._restingFace());
            this._p.eyes.set({scale_y: 1, translation_x: 0});
        }

        this._p.body.ease({
            scale_x: hover ? 1.08 : 1,
            scale_y: hover ? 1.08 : 1,
            duration: 200,
            mode: M.EASE_OUT_BACK,
        });
        if (hover && !this._busy) {
            this._wave(2);
            if (chance(2))
                this._say(chance(3) ? (this._sys?.randomPhrase() ?? pick(HOVER_PHRASES)) : pick(HOVER_PHRASES));
        }
    }

    _onPress(event) {
        if (this._goingAway) {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_STOP;
            this._press?.grab?.dismiss();
            const [x, y] = event.get_coords();
            const [ax, ay] = this._actor.get_position();
            this._press = {x, y, ax, ay, goodbye: true, grab: global.stage.grab(this._actor)};
            return Clutter.EVENT_STOP;
        }
        if (event.get_button() === Clutter.BUTTON_SECONDARY) {
            this._touch();
            this._interrupt();
            this._openMenu();
            return Clutter.EVENT_STOP;
        }
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        this._touch();
        // Berhenti di tempat dulu, supaya klik/drag tepat di posisi sekarang
        if (this._moving) {
            this._stopRun();
            this._savePosition();
        }
        this._actor.remove_transition('x');
        this._actor.remove_transition('y');
        this._press?.grab?.dismiss();
        const [x, y] = event.get_coords();
        const [ax, ay] = this._actor.get_position();
        this._press = {x, y, ax, ay, lastX: x, dragging: false, t: Date.now()};
        this._press.grab = global.stage.grab(this._actor);
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        if (!this._press)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        if (this._press.goodbye) {
            this._moveTo(this._press.ax + x - this._press.x, this._press.ay + y - this._press.y);
            return Clutter.EVENT_STOP;
        }
        const dx = x - this._press.x;
        const dy = y - this._press.y;
        if (!this._press.dragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD)
                return Clutter.EVENT_STOP;
            this._press.dragging = true;
            this._startDrag();
        }
        this._moveTo(this._press.ax + dx, this._press.ay + dy);

        const tilt = clamp((x - this._press.lastX) * 2, -15, 15);
        this._press.lastX = x;
        this._p.bounce.ease({rotation_angle_z: tilt, duration: 80, mode: M.EASE_OUT_QUAD});
        return Clutter.EVENT_STOP;
    }

    _onRelease(event) {
        if (!this._press || event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (this._press.goodbye) {
            this._press.grab?.dismiss();
            this._press = null;
            return Clutter.EVENT_STOP;
        }
        const {dragging, grab, t} = this._press;
        this._press = null;
        grab?.dismiss();

        if (dragging) {
            this._endDrag(Date.now() - t);
            return Clutter.EVENT_STOP;
        }

        if (this._exhausted) {
            this._interrupt();
            this._angryWake();
            this._openMenu();
            return Clutter.EVENT_STOP;
        }

        // Klik bertubi-tubi bikin kesal
        const now = Date.now();
        this._clicks = this._clicks.filter(c => now - c < 3000);
        this._clicks.push(now);
        this._interrupt();
        if (this._clicks.length >= 4) {
            this._clicks = [];
            this._moodAngry('Jangan diklik-klik terus! 😤');
            return Clutter.EVENT_STOP;
        }
        this._sayNow(pick(['Mau ngapain, bang? 😄', `Siap melayani! ${this._ch.logo}`, 'Pilih satu ya~ 👇']));
        this._hop(1.6 * U);
        this._openMenu();
        return Clutter.EVENT_STOP;
    }

    _startDrag() {
        const p = this._p;
        this._interrupt();
        this._state = 'drag';
        this._setFace(this._exhausted ? 'angry' : 'dizzy');
        global.window_group.set_child_above_sibling(this._actor, null);
        if (this._exhausted)
            this._sayNow(pick(['Eh eh! Aku lagi tidur! 😠', 'Turunin! Ngantuk tau! 😤']));

        p.bounce.remove_all_transitions();
        p.bounce.set({translation_y: 0, scale_x: 1, scale_y: 1});
        p.bounce.set_pivot_point(0.5, 1.0);
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        p.armL.ease({rotation_angle_z: 65, duration: 140, mode: M.EASE_OUT_BACK});
        p.armR.ease({rotation_angle_z: -65, duration: 140, mode: M.EASE_OUT_BACK});
        p.legs.forEach((leg, i) => {
            leg.remove_all_transitions();
            this._loop(leg, {rotation_angle_z: i % 2 ? 20 : -20}, 150);
        });
        if (!this._exhausted && chance(2))
            this._sayNow(pick(DRAG_PHRASES));
    }

    _endDrag(heldMs) {
        const p = this._p;
        this._savePosition();

        p.legs.forEach(leg => {
            leg.remove_all_transitions();
            leg.ease({rotation_angle_z: 0, translation_y: 0, duration: 150, mode: M.EASE_OUT_QUAD});
        });
        p.armL.ease({rotation_angle_z: 0, duration: 200, mode: M.EASE_OUT_BACK});
        p.armR.ease({
            rotation_angle_z: 0,
            duration: 200,
            mode: M.EASE_OUT_BACK,
            onComplete: () => this._p && this._armsIdle(),
        });
        p.bounce.ease({rotation_angle_z: 0, duration: 150, mode: M.EASE_OUT_QUAD});

        this._state = this._actor.hover ? 'hover' : 'idle';
        this._restack();

        if (this._exhausted) {
            this._land(() => this._resetPose());
            return;
        }
        if (heldMs > 4000 && chance(2)) {
            this._later(300, () => this._moodAngry('Jangan dibawa-bawa lama dong! 😤'));
            return;
        }
        this._setFace('happy');
        this._land(() => this._later(800, () => this._setFace(this._restingFace())));
        if (chance(2))
            this._later(250, () => this._say(pick(LAND_PHRASES)));
    }

    // --- interaksi dari menu ----------------------------------------------

    _hearts(n = 4, symbol = '💕') {
        for (let i = 0; i < n; i++) {
            this._later(i * 220, () => this._sceneToken && this._floatLabel(symbol, 'ngoding-emote',
                rand(2, 13) * U, rand(0, 3) * U, {dx: rand(-20, 20), dy: -rand(50, 80), duration: 1200}));
        }
    }

    _interactFeed() {
        this._interrupt();
        const alive = this._startScene();
        const p = this._p;
        const food = pick(['🍙', '🍩', '🍕', '🍪', '🍜', '🍰', '🍗', '🍫']);
        this._sayNow(pick(['Wah makanan! 🤤', 'Buat aku? Asik! 😍']));
        this._setFace('happy');
        const f = this._propLabel(food, 'ngoding-prize', 6.6 * U, -8 * U);
        f.set_pivot_point(0.5, 0.5);
        f.opacity = 0;
        f.ease({opacity: 255, translation_y: 12.5 * U, rotation_angle_z: 20, duration: 650, mode: M.EASE_IN_QUAD,
            onComplete: () => {
                if (!alive())
                    return;
                f.ease({scale_x: 0.2, scale_y: 0.2, opacity: 0, duration: 200, onComplete: () => f.destroy()});
                this._setFace('blow');
                let n = 0;
                const chomp = () => {
                    if (!alive())
                        return;
                    p.char.remove_all_transitions();
                    p.char.ease({scale_y: 0.88, scale_x: 1.08, duration: 110, mode: M.EASE_OUT_QUAD,
                        onComplete: () => p.char.ease({scale_y: 1, scale_x: 1, duration: 110})});
                    p.mouth.visible = n % 2 === 0;
                    this._floatLabel('·', 'ngoding-crumb', rand(6, 10) * U, 6 * U,
                        {dx: rand(-20, 20), dy: 20, duration: 500});
                    if (++n < 6) {
                        this._later(240, chomp);
                        return;
                    }
                    this._setFace('happy');
                    // perut kenyang
                    p.char.ease({scale_x: 1.1, duration: 250, mode: M.EASE_OUT_BACK,
                        onComplete: () => p.char.ease({scale_x: 1, duration: 600, mode: M.EASE_IN_OUT_SINE})});
                    this._sayNow(pick([`Nyam nyam! ${food} enak banget 😋`, 'Kenyang~ makasih bang! 🥰',
                        'Energi penuh! Siap ngoding lagi 💪']));
                    this._hearts(4, pick(['💕', '✨', '😋']));
                    this._later(1800, () => alive() && this._hop(2 * U, () => this._endScene()));
                };
                chomp();
            }});
    }

    _interactPat() {
        this._interrupt();
        const alive = this._startScene();
        const p = this._p;
        this._stopFloat();
        const hand = this._propLabel('🤚', 'ngoding-hand', 6 * U, -4.5 * U);
        hand.set_pivot_point(0.5, 1.0);
        hand.opacity = 0;
        hand.ease({opacity: 255, duration: 200});
        this._setFace('sleepy');
        this._sayNow(pick(['Hehe~ enak dielus 🥰', 'Purr~ 😌', 'Lagi dong bang~ 🥺']));
        // badan meleleh
        p.char.remove_all_transitions();
        p.char.ease({scale_y: 0.9, scale_x: 1.06, duration: 400, mode: M.EASE_OUT_QUAD});
        p.hat.ease({translation_y: 0.4 * U, duration: 300});
        let n = 0;
        const pat = () => {
            if (!alive())
                return;
            hand.ease({translation_x: n % 2 ? -1.5 * U : 1.5 * U, translation_y: n % 2 ? 0 : 0.6 * U,
                duration: 230, mode: M.EASE_IN_OUT_SINE});
            p.bounce.ease({rotation_angle_z: n % 2 ? -3 : 3, duration: 230});
            if (n % 2 === 0)
                this._floatLabel('💕', 'ngoding-emote', rand(3, 12) * U, rand(0, 3) * U,
                    {dy: -60, duration: 1100});
            if (++n < 10) {
                this._later(240, pat);
                return;
            }
            hand.ease({opacity: 0, translation_y: -2 * U, duration: 250});
            this._setFace('happy');
            this._sayNow(pick(['Makasih udah sayang aku 💖', 'Aku jadi semangat! ✨']));
            this._later(1500, () => alive() && this._endScene());
        };
        this._later(250, pat);
    }

    _interactPinch() {
        this._interrupt();
        const alive = this._startScene();
        const p = this._p;
        const side = chance(2) ? 1 : -1;
        const hand = this._propLabel('🤏', 'ngoding-hand',
            side > 0 ? 13 * U : -0.5 * U, 4.5 * U);
        hand.opacity = 0;
        hand.ease({opacity: 255, duration: 150});
        this._later(250, () => {
            if (!alive())
                return;
            this._setFace('dizzy');
            this._sayNow(pick(['Aduh! Sakit tau 😣', 'Aww aww aww! 😖', 'Pipiku ditarik! 😫']));
            // pipi ditarik ke samping lalu lepas
            p.char.remove_all_transitions();
            p.char.set_pivot_point(side > 0 ? 0 : 1, 0.5);
            p.char.ease({scale_x: 1.25, duration: 300, mode: M.EASE_OUT_QUAD});
            hand.ease({translation_x: 2 * U * side, duration: 300, mode: M.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!alive())
                        return;
                    hand.ease({opacity: 0, duration: 150});
                    p.char.ease({scale_x: 1, duration: 500, mode: M.EASE_OUT_ELASTIC,
                        onComplete: () => p.char.set_pivot_point(0.5, 1.0)});
                    this._later(500, () => {
                        if (!alive())
                            return;
                        // ngambek
                        this._setFace(chance(2) ? 'sad' : 'angry');
                        this._sayNow(pick(['Hmph, aku ngambek 😤', 'Jahat... 🥺', 'Nanti aku bales lho 😠']));
                        p.bounce.ease({rotation_angle_z: -12 * side, duration: 300});
                        this._floatLabel(pick(['💢', '💧']), 'ngoding-emote', 12 * U, 0, {dy: -40, duration: 900});
                        this._later(2200, () => alive() && this._endScene());
                    });
                }});
        });
    }

    _interactWhip() {
        this._interrupt();
        const alive = this._startScene();
        const p = this._p;
        // cambuk: garis melengkung yang menyabet
        const whip = this._prop(shape(10 * U, 0.35 * U, TOY.whip), CHAR_W + U, 2 * U);
        whip.set_pivot_point(1.0, 0.5);
        whip.set({rotation_angle_z: -60, opacity: 0});
        whip.ease({opacity: 255, duration: 100});
        whip.ease({rotation_angle_z: 15, duration: 160, mode: M.EASE_IN_QUAD,
            onComplete: () => {
                if (!alive())
                    return;
                this._floatLabel('CTAR!', 'ngoding-ctar', 9 * U, -U, {dy: -20, duration: 600});
                whip.ease({opacity: 0, duration: 200});
                // kaget: lompat & gemetar
                this._setFace('dizzy');
                p.bounce.ease({translation_y: -2.5 * U, duration: 120, mode: M.EASE_OUT_QUAD,
                    onComplete: () => p.bounce.ease({translation_y: 0, duration: 200, mode: M.EASE_OUT_BOUNCE})});
                let n = 0;
                const shake = () => {
                    if (!alive())
                        return;
                    p.bounce.ease({translation_x: n % 2 ? 3 : -3, duration: 40,
                        onComplete: () => (++n < 10 ? shake() : salute())});
                };
                const salute = () => {
                    if (!alive())
                        return;
                    p.bounce.ease({translation_x: 0, duration: 80});
                    // hormat 🫡
                    p.armR.remove_all_transitions();
                    p.armR.ease({rotation_angle_z: -125, duration: 200, mode: M.EASE_OUT_BACK});
                    this._setFace('normal');
                    p.char.remove_all_transitions();
                    p.char.ease({scale_y: 1.05, scale_x: 0.97, duration: 200});
                    const lvl = this._limitLevel()?.pct ?? 0;
                    this._sayNow(lvl >= 80
                        ? `Baik tuan, akan aku kerjakan... walau limitku tinggal ${100 - lvl}% 😭🫡`
                        : 'Baik tuan, akan aku kerjakan 🫡');
                    this._later(2200, () => {
                        if (!alive())
                            return;
                        // langsung kerja
                        this._endScene();
                        this._sceneCode();
                    });
                };
                this._later(200, shake);
            }});
    }

    _launchSwitch() {
        try {
            const proc = Gio.Subprocess.new(
                ['ptyxis', '--new-window', `--title=${APP_NAME} – Ganti Akun ${this._ch.name}`,
                    '-x', `${SWITCH_SCRIPT} ${this._charId}`],
                Gio.SubprocessFlags.NONE);
            proc.wait_async(null, null);
        } catch (e) {
            logError(e, 'teman-ngoding: switch account');
            Main.notify(APP_NAME, 'Tidak bisa membuka jendela ganti akun');
        }
    }

    _goodbye() {
        // Nangis sesenggukan dulu, lalu menghilang dan mematikan ekstensi
        this._interrupt();
        this._exhausted = false;
        this._cancel(this._snoreId);
        this._goingAway = true;
        try {
            GLib.file_set_contents(GLib.build_filenamev([GLib.get_user_cache_dir(), 'teman-ngoding-was-off']), '1');
        } catch (e) {
            logError(e, 'teman-ngoding: flag');
        }
        const alive = this._startScene();
        const p = this._p;
        this._stopFloat();
        this._setFace('sad');
        this._sayNow(pick(['Hiks... abang mau matiin aku? 🥺', 'Yah... aku disuruh pergi ya? 🥺']));
        p.hat.ease({rotation_angle_z: -15, translation_y: 0.3 * U, duration: 400});
        p.armL.remove_all_transitions();
        p.armR.remove_all_transitions();
        p.armL.ease({rotation_angle_z: -35, duration: 400});
        p.armR.ease({rotation_angle_z: 35, duration: 400});

        let n = 0;
        const sob = () => {
            if (!alive())
                return;
            // sesenggukan: badan tersentak
            p.char.remove_all_transitions();
            p.char.ease({scale_y: 0.9, scale_x: 1.06, duration: 90, mode: M.EASE_OUT_QUAD,
                onComplete: () => p.char.ease({scale_y: 1, scale_x: 1, duration: 160})});
            p.bounce.ease({translation_y: -0.5 * U, duration: 90,
                onComplete: () => p.bounce.ease({translation_y: 0, duration: 140})});
            // air mata deras
            for (const ex of [5.3, 10.3]) {
                const t = this._prop(shape(0.5 * U, 0.8 * U, TOY.tear), ex * U, 6.2 * U);
                t.ease({translation_y: 4 * U, translation_x: rand(-6, 7), opacity: 0, duration: 700,
                    mode: M.EASE_IN_QUAD, onComplete: () => t.destroy()});
            }
            if (n % 3 === 0)
                this._floatLabel(pick(['hiks', 'hiks..', 'huhu']), 'ngoding-sob', rand(1, 12) * U, 0,
                    {dy: -40, duration: 1000});
            n++;
            if (n === 8)
                this._sayNow(pick(['Dadah bang... panggil aku lagi ya 😭👋', 'Jangan lupain aku ya... 😭👋']));
            if (n === 9)
                this._wave(3);
            if (n < 16) {
                this._later(n < 8 ? 420 : 300, sob);
                return;
            }
            // menghilang
            this._later(600, () => {
                if (!alive())
                    return;
                this._floatLabel('💨', 'ngoding-pop', 6 * U, 3 * U, {dy: -20, duration: 700});
                this._actor.set_pivot_point(0.5, 0.75);
                this._actor.ease({scale_x: 0.05, scale_y: 0.05, opacity: 0, rotation_angle_z: 90,
                    duration: 600, mode: M.EASE_IN_BACK,
                    onComplete: () => {
                        try {
                            Main.extensionManager.disableExtension(this._uuid);
                        } catch (e) {
                            logError(e, 'teman-ngoding: disable');
                            this._actor?.hide();
                        }
                    }});
            });
        };
        this._later(800, sob);
    }

    // --- menu klik & status -----------------------------------------------

    _destroyMenus() {
        this._menu?.destroy();
        this._statusMenu?.destroy();
        this._menu = this._statusMenu = this._menuManager = null;
    }

    _ensureMenus() {
        if (this._menu)
            return;
        const ch = this._ch;
        const theme = `ngoding-theme-${this._charId}`;
        this._menuManager = new PopupMenu.PopupMenuManager(this._actor);

        this._menu = new PopupMenu.PopupMenu(this._actor, 0.5, St.Side.TOP);
        this._menu.actor.add_style_class_name('ngoding-menu');
        this._menu.actor.add_style_class_name(theme);
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._menuManager.addMenu(this._menu);

        // Panel utama: satu kartu berisi header, pilihan karakter, 3 tombol besar,
        // dan ikon interaksi
        const homeCard = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false,
            style_class: 'ngoding-home-item'});
        const home = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'ngoding-home', x_expand: true});
        homeCard.add_child(home);
        this._menu.addMenuItem(homeCard);

        // Header
        const header = new St.BoxLayout({style_class: 'ngoding-home-header'});
        header.add_child(new St.Label({text: ch.logo, style_class: 'ngoding-home-logo',
            y_align: Clutter.ActorAlign.CENTER}));
        const htexts = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        htexts.add_child(new St.Label({text: ch.name, style_class: 'ngoding-home-title'}));
        this._homeSub = new St.Label({text: 'Mau ngapain, bang?', style_class: 'ngoding-home-sub'});
        htexts.add_child(this._homeSub);
        header.add_child(htexts);
        this._homePlan = new St.Label({style_class: 'ngoding-status-plan',
            y_align: Clutter.ActorAlign.CENTER, visible: false});
        header.add_child(this._homePlan);
        // Tombol kecil untuk membuka pilihan karakter
        const swap = new St.Button({style_class: 'ngoding-swap', label: '⇄', can_focus: true,
            track_hover: true, y_align: Clutter.ActorAlign.CENTER});
        header.add_child(swap);
        home.add_child(header);

        const closeThen = fn => {
            this._menu.close();
            this._later(150, fn);
        };

        // Pilihan karakter (tersembunyi sampai tombol ⇄ ditekan)
        const picker = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'ngoding-picker', visible: false});
        picker.add_child(new St.Label({text: 'GANTI TEMAN', style_class: 'ngoding-section'}));
        const chips = new St.BoxLayout({style_class: 'ngoding-chips'});
        for (const [id, def] of Object.entries(CHARACTERS)) {
            const active = id === this._charId;
            const chip = new St.Button({
                style_class: `ngoding-chip ngoding-chip-${id}${active ? ' ngoding-chip-active' : ''}`,
                can_focus: true, track_hover: true, x_expand: true, reactive: !active,
            });
            const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
                x_align: Clutter.ActorAlign.CENTER, x_expand: true});
            box.add_child(new St.Label({text: def.logo, style_class: 'ngoding-chip-emoji',
                x_align: Clutter.ActorAlign.CENTER}));
            box.add_child(new St.Label({text: def.name, style_class: 'ngoding-chip-label',
                x_align: Clutter.ActorAlign.CENTER}));
            chip.set_child(box);
            chip.connect('clicked', () => closeThen(() => this._switchCharacter(id)));
            chips.add_child(chip);
        }
        picker.add_child(chips);
        home.add_child(picker);
        swap.connect('clicked', () => {
            picker.visible = !picker.visible;
            swap.checked = picker.visible;
            if (picker.visible)
                this._sayNow(pick(['Mau ganti teman? 🥺', 'Pilih siapa nih? 👀', 'Aku diganti?! ... oke deh 😔']));
        });
        this._picker = picker;
        this._swap = swap;

        // Tombol utama
        const tiles = new St.BoxLayout({style_class: 'ngoding-tiles'});
        const tile = (emoji, label, fn) => {
            const b = new St.Button({style_class: 'ngoding-tile', can_focus: true,
                x_expand: true, track_hover: true});
            const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
                x_align: Clutter.ActorAlign.CENTER, x_expand: true});
            box.add_child(new St.Label({text: emoji, style_class: 'ngoding-tile-emoji',
                x_align: Clutter.ActorAlign.CENTER}));
            box.add_child(new St.Label({text: label, style_class: 'ngoding-tile-label',
                x_align: Clutter.ActorAlign.CENTER}));
            b.set_child(box);
            b.connect('clicked', () => closeThen(fn));
            tiles.add_child(b);
        };
        tile('💻', ch.cli, () => {
            this._sayNow(`Siap! Buka ${ch.cli} ${ch.logo}`);
            this._launch();
        });
        tile('🌐', 'Browser', () => {
            this._sayNow(`Meluncur ke ${ch.site} 🌐`);
            this._launchBrowser();
        });
        tile('👤', 'Akun Saya', () => this._openStatus());
        home.add_child(tiles);

        // Interaksi: ikon saja, namanya muncul saat disorot
        home.add_child(new St.Label({text: 'INTERAKSI', style_class: 'ngoding-section'}));
        const row = new St.BoxLayout({style_class: 'ngoding-interact-row',
            x_align: Clutter.ActorAlign.CENTER});
        const hint = new St.Label({text: 'Pilih salah satu~', style_class: 'ngoding-interact-hint',
            x_align: Clutter.ActorAlign.CENTER});
        const ibtn = (emoji, label, fn) => {
            const b = new St.Button({style_class: 'ngoding-ibtn', can_focus: true,
                track_hover: true, label: emoji});
            b.connect('notify::hover', () => {
                hint.text = b.hover ? (typeof label === 'function' ? label() : label) : 'Pilih salah satu~';
            });
            b.connect('clicked', () => closeThen(fn));
            row.add_child(b);
        };
        ibtn('🍙', 'Kasih makan', () => this._interactFeed());
        ibtn('🤚', 'Pat pat', () => this._interactPat());
        ibtn('🤏', 'Cubit', () => this._interactPinch());
        ibtn('🪢', 'Pecut', () => this._interactWhip());
        ibtn('😴', () => (this._exhausted ? 'Bangunin' : 'Tidurkan (simulasi limit habis)'),
            () => this._toggleSleepSim());
        home.add_child(row);
        home.add_child(hint);

        // Ringkasan limit / akun
        this._homeStats = new St.Label({style_class: 'ngoding-home-stats',
            x_align: Clutter.ActorAlign.CENTER});
        home.add_child(this._homeStats);

        // Matikan
        const off = new St.Button({style_class: 'ngoding-off', label: `⏻  Matikan ${APP_NAME}`,
            can_focus: true, x_align: Clutter.ActorAlign.CENTER});
        off.connect('clicked', () => closeThen(() => this._goodbye()));
        home.add_child(off);

        this._statusMenu = new PopupMenu.PopupMenu(this._actor, 0.5, St.Side.TOP);
        this._statusMenu.actor.add_style_class_name('ngoding-menu');
        this._statusMenu.actor.add_style_class_name(theme);
        Main.uiGroup.add_child(this._statusMenu.actor);
        this._statusMenu.actor.hide();
        this._menuManager.addMenu(this._statusMenu);

        const card = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false,
            style_class: 'ngoding-status-item'});
        this._statusBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'ngoding-status',
            x_expand: true,
        });
        card.add_child(this._statusBox);
        this._statusMenu.addMenuItem(card);

        const switchItem = new PopupMenu.PopupMenuItem(`🔁  Ganti Akun ${ch.name}`);
        switchItem.add_style_class_name('ngoding-switch-item');
        switchItem.connect('activate', () => {
            this._sayNow('Oke! Login akun lain ya 🔐');
            this._launchSwitch();
        });
        this._statusMenu.addMenuItem(switchItem);

        const refresh = new PopupMenu.PopupMenuItem('🔄  Perbarui data');
        refresh.connect('activate', () => this._later(120, () => this._openStatus()));
        this._statusMenu.addMenuItem(refresh);
    }

    _openMenu() {
        this._ensureMenus();
        if (this._moving)
            this._stopRun();
        this._statusMenu.close();
        this._picker.visible = false;
        this._swap.checked = false;
        this._updateHome();
        this._menu.open(true);
    }

    _updateHome() {
        this._homeSub.text = `${APP_NAME} • ${pick(['Mau ngapain, bang?', `Siap melayani! ${this._ch.logo}`,
            'Ada yang bisa dibantu? 😄', 'Pilih, pilih~ 👇'])}`;
        const st = this._readStatus();
        const acc = this._account(st);
        const plan = acc?.plan;
        this._homePlan.visible = !!plan;
        if (plan)
            this._homePlan.text = plan.toUpperCase();
        const u = this._usage(st);
        const parts = [];
        if (u?.session)
            parts.push(`Sesi ${Math.round(u.session.percent)}%`);
        if (u?.weekly)
            parts.push(`Mingguan ${Math.round(u.weekly.percent)}%`);
        let text = parts.length ? `⚡ ${parts.join('  •  ')} terpakai` : '';
        if (!text && this._charId !== 'claude' && st) {
            const agent = st.agents?.[this._charId];
            if (agent && !agent.installed)
                text = `⚠️ ${this._ch.cli} belum terpasang`;
            else if (agent && !acc)
                text = '🔐 Belum login';
            else if (acc?.email)
                text = `👤 ${acc.email}`;
        }
        this._homeStats.text = text;
        this._homeStats.visible = !!text;
    }

    // Info akun karakter aktif dari status.json (tanpa token)
    _account(status) {
        if (!status)
            return null;
        if (this._charId === 'claude')
            return status.accounts?.root ?? status.accounts?.yandi ?? null;
        return status.agents?.[this._charId]?.account ?? null;
    }

    // Pemakaian limit hanya tersedia untuk Claude Code
    _usage(status = this._readStatus()) {
        return this._charId === 'claude' ? status?.usage ?? null : null;
    }

    _openStatus() {
        this._ensureMenus();
        if (this._moving)
            this._stopRun();
        this._menu.close();
        this._renderStatus(this._readStatus(), true);
        this._statusMenu.open(true);
        this._refreshStatus();
    }

    _readStatus() {
        try {
            const [ok, bytes] = GLib.file_get_contents(STATUS_FILE);
            if (ok)
                return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            // belum ada
        }
        return null;
    }

    _refreshStatus() {
        if (this._statusProc)
            return;
        try {
            this._statusProc = Gio.Subprocess.new(
                ['systemctl', 'start', STATUS_UNIT], Gio.SubprocessFlags.NONE);
            this._statusProc.wait_async(null, () => {
                this._statusProc = null;
                if (this._statusMenu?.isOpen) {
                    const status = this._readStatus();
                    this._renderStatus(status, false);
                    this._reactToStatus(status);
                }
            });
        } catch (e) {
            this._statusProc = null;
            logError(e, 'teman-ngoding: refresh status');
        }
    }

    _reactToStatus(status) {
        if (this._charId !== 'claude') {
            const agent = status?.agents?.[this._charId];
            if (agent && !agent.installed)
                this._sayNow(`${this._ch.cli} belum terpasang nih 😅`);
            else if (!agent?.account)
                this._sayNow('Aku belum login... klik Ganti Akun ya 🔐');
            else
                this._sayNow(pick(['Akunnya aman! Gas ngoding 🚀', 'Siap kerja! 💪']));
            return;
        }
        const weekly = status?.usage?.weekly?.percent;
        const session = status?.usage?.session?.percent;
        if (weekly === undefined || weekly === null) {
            this._sayNow('Hmm, datanya belum bisa diambil 🤔');
            return;
        }
        if (weekly >= 90 || session >= 90)
            this._sayNow('Limit hampir habis! Hemat-hemat ya bang 😬');
        else if (weekly >= 70 || session >= 70)
            this._sayNow('Udah lumayan kepake, pelan-pelan ya 🙏');
        else
            this._sayNow('Masih aman! Gas ngoding 🚀');
    }

    _renderStatus(status, loading) {
        const box = this._statusBox;
        box.destroy_all_children();
        box.add_child(new St.Label({text: `👤  Akun ${this._ch.name}`, style_class: 'ngoding-status-title'}));

        if (!status) {
            box.add_child(new St.Label({
                text: loading ? 'Mengambil data...' : 'Data belum tersedia.',
                style_class: 'ngoding-status-muted',
            }));
            return;
        }

        if (this._charId === 'claude')
            this._renderClaudeStatus(box, status);
        else
            this._renderAgentStatus(box, status.agents?.[this._charId]);

        const ago = Math.max(0, Math.round(Date.now() / 1000 - status.updated_at));
        box.add_child(new St.Label({
            text: `${loading ? '⏳ Memperbarui... • ' : ''}diperbarui ${ago < 60 ? 'barusan' : `${Math.round(ago / 60)} menit lalu`}`,
            style_class: 'ngoding-status-small',
        }));
    }

    _accountRow(box, name, email, plan) {
        const row = new St.BoxLayout({style_class: 'ngoding-status-account'});
        const who = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        who.add_child(new St.Label({text: name, style_class: 'ngoding-status-name'}));
        who.add_child(new St.Label({text: email ?? '-', style_class: 'ngoding-status-muted'}));
        row.add_child(who);
        if (plan) {
            row.add_child(new St.Label({
                text: plan.toUpperCase(),
                style_class: 'ngoding-status-plan',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        box.add_child(row);
    }

    _renderClaudeStatus(box, status) {
        const acc = status.accounts?.root ?? status.accounts?.yandi;
        if (acc) {
            this._accountRow(box, acc.name ?? 'Akun Claude', acc.email, acc.plan);
            const users = Object.entries(status.accounts)
                .map(([user, a]) => `${user === 'root' ? `${APP_NAME} (root)` : `user ${user}`}: ${a.email ?? '-'}`);
            box.add_child(new St.Label({text: users.join('\n'), style_class: 'ngoding-status-small'}));
        }

        const u = status.usage;
        if (u) {
            const bar = (title, part) => {
                if (!part)
                    return;
                const pct = clamp(part.percent, 0, 100);
                const row = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
                    style_class: 'ngoding-status-limit'});
                const top = new St.BoxLayout();
                top.add_child(new St.Label({text: title, style_class: 'ngoding-status-label', x_expand: true}));
                top.add_child(new St.Label({text: `${Math.round(pct)}% terpakai`,
                    style_class: 'ngoding-status-pct'}));
                row.add_child(top);
                const trackW = 260;
                const track = new St.Widget({style_class: 'ngoding-bar-track', width: trackW, height: 10});
                const level = pct >= 85 ? 'high' : pct >= 60 ? 'mid' : 'low';
                const fill = new St.Widget({style_class: `ngoding-bar-fill ngoding-bar-${level}`,
                    width: Math.max(4, Math.round(trackW * pct / 100)), height: 10});
                track.add_child(fill);
                row.add_child(track);
                row.add_child(new St.Label({
                    text: `Sisa ${Math.round(100 - pct)}% • reset ${relativeTime(part.resets_at)}`,
                    style_class: 'ngoding-status-small',
                }));
                box.add_child(row);
            };
            bar('Sesi (5 jam)', u.session);
            bar('Mingguan', u.weekly);
            bar('Mingguan – Opus', u.weekly_opus);
            bar('Mingguan – Sonnet', u.weekly_sonnet);
        } else if (status.error) {
            box.add_child(new St.Label({text: `Gagal ambil limit: ${status.error}`,
                style_class: 'ngoding-status-muted'}));
        }
    }

    _renderAgentStatus(box, agent) {
        const ch = this._ch;
        const muted = text => box.add_child(new St.Label({text, style_class: 'ngoding-status-muted'}));
        const small = text => box.add_child(new St.Label({text, style_class: 'ngoding-status-small'}));
        if (!agent) {
            muted('Data belum tersedia.');
            return;
        }
        if (!agent.installed) {
            muted(`${ch.cli} belum terpasang.`);
            return;
        }
        const acc = agent.account;
        if (acc) {
            this._accountRow(box, acc.name ?? `Akun ${ch.name}`, acc.email ?? acc.auth, acc.plan);
            if (acc.providers?.length)
                small(`Provider: ${acc.providers.join(', ')}`);
            if (acc.email && acc.auth)
                small(`Login: ${acc.auth}`);
        } else {
            muted('Belum login. Tekan "Ganti Akun" untuk login.');
        }
        if (agent.version)
            small(`${ch.cli} ${agent.version}`);
        if (agent.note)
            small(agent.note);
        small('Info sisa limit hanya tersedia untuk Claude Code.');
    }

    _launchBrowser() {
        const url = this._ch.url;
        try {
            const chrome = GioUnix.DesktopAppInfo.new('google-chrome.desktop');
            if (chrome) {
                chrome.launch_uris([url], global.create_app_launch_context(0, -1));
                return;
            }
            Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
        } catch (e) {
            logError(e, 'teman-ngoding: browser');
            Main.notify(APP_NAME, 'Tidak bisa membuka Chrome');
        }
    }

    _launch() {
        try {
            const proc = Gio.Subprocess.new([LAUNCH_SCRIPT, this._charId], Gio.SubprocessFlags.NONE);
            proc.wait_async(null, null);
        } catch (e) {
            logError(e, 'teman-ngoding: launch');
            Main.notify(APP_NAME, `Tidak bisa membuka ${this._ch.cli}`);
        }
    }
}
