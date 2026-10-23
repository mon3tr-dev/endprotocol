//! Windows 可执行文件图标提取。
//!
//! Steam 库条目的 `icon` 字段只接受图片文件路径，因此默认图标需要先把
//! `Endfield.exe` 内嵌的 `RT_GROUP_ICON` / `RT_ICON` 资源重新组装成标准 `.ico`，
//! 再写入应用数据目录交给 `utils::steam` 使用。

use std::fs;
use std::path::{Path, PathBuf};

/// 从 `exe_path` 提取内嵌图标并写出到 `out_path`（通常为 `.ico`）。
///
/// 失败返回 `Err`：调用方（Steam 快捷方式默认值）会回退到主程序图标。
pub fn extract_icon(exe_path: &Path, out_path: &Path) -> Result<PathBuf, String> {
    if !exe_path.is_file() {
        return Err(format!(
            "Icon source does not exist: {}",
            exe_path.display()
        ));
    }

    let bytes = load_icon_bytes(exe_path)?;

    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }

    // 先写临时文件再改名，避免 Steam 读到只写了一半的图标文件。
    let temporary = out_path.with_extension("ico.tmp");
    fs::write(&temporary, &bytes)
        .map_err(|error| format!("Could not write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, out_path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not replace {}: {error}", out_path.display())
    })?;

    Ok(out_path.to_path_buf())
}

#[cfg(target_os = "windows")]
fn load_icon_bytes(exe_path: &Path) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::{FreeLibrary, HMODULE, HRSRC};
    use windows_sys::Win32::System::LibraryLoader::{
        EnumResourceNamesW, FindResourceW, LoadLibraryExW, LoadResource, LockResource,
        SizeofResource, LOAD_LIBRARY_AS_DATAFILE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{RT_GROUP_ICON, RT_ICON};

    /// 资源名同时支持整型 ID 与字符串两种形式。
    #[derive(Clone)]
    enum ResourceName {
        Id(u16),
        Text(Vec<u16>),
    }

    impl ResourceName {
        /// 转成 `FindResourceW` 需要的 `LPCWSTR`（整型 ID 直接放在指针低位）。
        fn as_ptr(&self) -> *const u16 {
            match self {
                ResourceName::Id(id) => *id as usize as *const u16,
                ResourceName::Text(units) => units.as_ptr(),
            }
        }
    }

    struct LoadedModule(HMODULE);

    impl Drop for LoadedModule {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { FreeLibrary(self.0) };
            }
        }
    }

    fn wide(path: &Path) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;

        std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// 按资源名读取资源原始字节（`LockResource` 数据在模块卸载前都有效）。
    fn read_resource(
        module: HMODULE,
        name: &ResourceName,
        kind: *const u16,
    ) -> Result<Vec<u8>, String> {
        unsafe {
            let handle: HRSRC = FindResourceW(module, name.as_ptr(), kind);
            if handle.is_null() {
                return Err("Icon resource is missing from the executable.".to_string());
            }
            let size = SizeofResource(module, handle);
            if size == 0 {
                return Err("Icon resource is empty.".to_string());
            }
            let loaded = LoadResource(module, handle);
            if loaded.is_null() {
                return Err("Could not load the icon resource.".to_string());
            }
            let pointer = LockResource(loaded) as *const u8;
            if pointer.is_null() {
                return Err("Could not lock the icon resource.".to_string());
            }
            Ok(std::slice::from_raw_parts(pointer, size as usize).to_vec())
        }
    }

    /// 收集图标组名：ID 形式（`MAKEINTRESOURCE`）与字符串形式分开保存。
    unsafe extern "system" fn collect_group_names(
        _module: HMODULE,
        _kind: windows_sys::core::PCWSTR,
        name: windows_sys::core::PCWSTR,
        lparam: isize,
    ) -> windows_sys::core::BOOL {
        // IS_INTRESOURCE：指针值小于 0x10000 时低 16 位就是资源 ID。
        const IS_INTRESOURCE_LIMIT: usize = 0x1_0000;

        let names = &mut *(lparam as *mut Vec<ResourceName>);
        if (name as usize) < IS_INTRESOURCE_LIMIT {
            names.push(ResourceName::Id(name as usize as u16));
        } else {
            let mut length = 0usize;
            while *name.add(length) != 0 {
                length += 1;
            }
            let units = std::slice::from_raw_parts(name, length);
            names.push(ResourceName::Text(units.to_vec()));
        }
        1
    }

    let path = wide(exe_path);
    let module = unsafe {
        LoadLibraryExW(
            path.as_ptr(),
            std::ptr::null_mut(),
            LOAD_LIBRARY_AS_DATAFILE,
        )
    };
    if module.is_null() {
        return Err(format!(
            "Could not open {} for icon extraction.",
            exe_path.display()
        ));
    }
    let module = LoadedModule(module);

    let mut group_names: Vec<ResourceName> = Vec::new();
    unsafe {
        EnumResourceNamesW(
            module.0,
            RT_GROUP_ICON,
            Some(collect_group_names),
            &mut group_names as *mut Vec<ResourceName> as isize,
        );
    }
    if group_names.is_empty() {
        return Err(format!(
            "{} does not contain an icon resource.",
            exe_path.display()
        ));
    }

    // Explorer 取 ID 最小的图标组作为主图标；只有字符串命名时取第一个。
    group_names.sort_by_key(|name| match name {
        ResourceName::Id(id) => (0u8, *id),
        ResourceName::Text(_) => (1, 0),
    });
    let group = read_resource(module.0, &group_names[0], RT_GROUP_ICON)?;

    // GRPICONDIR：reserved(2) / type(2，恒为 1) / count(2)，随后是 count 个 14 字节条目。
    if group.len() < 6 {
        return Err("Icon group resource is truncated.".to_string());
    }
    if u16::from_le_bytes([group[0], group[1]]) != 0
        || u16::from_le_bytes([group[2], group[3]]) != 1
    {
        return Err("Icon group resource has an unexpected header.".to_string());
    }
    let count = u16::from_le_bytes([group[4], group[5]]) as usize;
    if count == 0 || group.len() < 6 + count * 14 {
        return Err("Icon group resource has no entries.".to_string());
    }

    struct Entry {
        width: u8,
        height: u8,
        color_count: u8,
        planes: u16,
        bit_count: u16,
        bytes: Vec<u8>,
    }

    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        let base = 6 + index * 14;
        let image_id = u16::from_le_bytes([group[base + 12], group[base + 13]]);
        let image = read_resource(module.0, &ResourceName::Id(image_id), RT_ICON)?;
        entries.push(Entry {
            width: group[base],
            height: group[base + 1],
            color_count: group[base + 2],
            planes: u16::from_le_bytes([group[base + 4], group[base + 5]]),
            bit_count: u16::from_le_bytes([group[base + 6], group[base + 7]]),
            bytes: image,
        });
    }

    // ICONDIR + ICONDIRENTRY（16 字节/条）+ 各图像数据 = 标准 .ico 文件。
    let mut out = Vec::with_capacity(
        6 + entries.len() * 16
            + entries
                .iter()
                .map(|entry| entry.bytes.len())
                .sum::<usize>(),
    );
    out.extend_from_slice(&[0, 0, 1, 0]);
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());

    let mut offset = 6 + entries.len() * 16;
    for entry in &entries {
        out.push(entry.width);
        out.push(entry.height);
        out.push(entry.color_count);
        out.push(0);
        out.extend_from_slice(&entry.planes.to_le_bytes());
        out.extend_from_slice(&entry.bit_count.to_le_bytes());
        out.extend_from_slice(&(entry.bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(&(offset as u32).to_le_bytes());
        offset += entry.bytes.len();
    }
    for entry in entries {
        out.extend_from_slice(&entry.bytes);
    }

    Ok(out)
}

#[cfg(not(target_os = "windows"))]
fn load_icon_bytes(_exe_path: &Path) -> Result<Vec<u8>, String> {
    Err("Executable icons can only be extracted on Windows.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_source() {
        let result = extract_icon(
            Path::new(r"Z:\does-not-exist\Endfield.exe"),
            Path::new(r"Z:\does-not-exist\out.ico"),
        );
        assert!(result.is_err());
    }
}
