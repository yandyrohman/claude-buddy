// Pemuat Teman Ngoding.
//
// Kode maskot ada di buddy.js. Saat enable, file itu disalin ke nama unik di
// $XDG_RUNTIME_DIR lalu di-import, sehingga perubahan buddy.js bisa dimuat
// ulang cukup dengan disable/enable ekstensi, tanpa logout.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TemanNgodingExtension extends Extension {
    enable() {
        const token = {};
        this._token = token;

        const src = this.dir.get_child('buddy.js');
        const runDir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_runtime_dir(), 'teman-ngoding']));
        try {
            runDir.make_directory_with_parents(null);
        } catch {
            // sudah ada
        }
        // Bersihkan salinan lama
        try {
            const children = runDir.enumerate_children('standard::name', 0, null);
            let info;
            while ((info = children.next_file(null)))
                runDir.get_child(info.get_name()).delete(null);
        } catch {
            // abaikan
        }
        const copy = runDir.get_child(`buddy-${GLib.get_monotonic_time()}.js`);
        src.copy(copy, Gio.FileCopyFlags.OVERWRITE, null, null);

        import(copy.get_uri()).then(module => {
            if (this._token !== token)
                return;
            this._buddy = new module.Buddy(this.path);
            this._buddy.enable();
        }).catch(e => logError(e, 'teman-ngoding: load'));
    }

    disable() {
        this._token = null;
        this._buddy?.disable();
        this._buddy = null;
    }
}
