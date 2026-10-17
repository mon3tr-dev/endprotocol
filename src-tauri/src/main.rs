// Prevents additional console window on Windows; DO NOT REMOVE!!
// debug 构建同样使用 Windows 子系统：控制台在运行期按需 AttachConsole 附接
// （见 lib.rs），避免被 Steam / 快捷方式等无控制台父进程拉起时闪现黑窗口。
#![windows_subsystem = "windows"]

fn main() {
    endprotocol_lib::run()
}
