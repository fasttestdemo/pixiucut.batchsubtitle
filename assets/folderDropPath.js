/**
 * 从拖放解析本机路径（不依赖 Node）。
 * 沙箱里 File.path 不保证有值，所以依次读 File.path、text/uri-list、text/plain。
 * 浏览器挂 globalThis.PluginFolderDrop。
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
  if (root) root.PluginFolderDrop = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function isExternalFileDrag(event) {
    var types = event && event.dataTransfer && event.dataTransfer.types
    if (!types) return false
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true
    }
    return false
  }

  function fileUrlToPath(raw) {
    var s = String(raw || '').trim().replace(/\r/g, '')
    if (!s) return ''
    s = s.split('\n')[0].trim()
    if (!s || s.charAt(0) === '#') return ''
    if (!/^file:/i.test(s)) return s
    var rest = s.replace(/^file:\/\//i, '')
    if (/^localhost/i.test(rest)) rest = rest.slice(9)
    try {
      rest = decodeURIComponent(rest)
    } catch (_) {
      /* keep rest */
    }
    if (/^\/[A-Za-z]:/.test(rest)) {
      return rest.slice(1).replace(/\//g, '\\')
    }
    return rest
  }

  function pathsFromFileList(files) {
    var out = []
    if (!files || !files.length) return out
    for (var i = 0; i < files.length; i++) {
      var item = files[i]
      if (!item || typeof item !== 'object') continue
      var p = typeof item.path === 'string' ? item.path.trim() : ''
      if (p) out.push(p)
    }
    return out
  }

  function pathsFromUriList(dataTransfer) {
    if (!dataTransfer || typeof dataTransfer.getData !== 'function') return []
    var text = ''
    try {
      text = dataTransfer.getData('text/uri-list') || ''
      if (!text) text = dataTransfer.getData('text/plain') || ''
    } catch (_) {
      return []
    }
    var out = []
    var lines = String(text).split(/\r?\n/)
    for (var i = 0; i < lines.length; i++) {
      var p = fileUrlToPath(lines[i])
      if (p) out.push(p)
    }
    return out
  }

  function dedupe(paths) {
    var seen = Object.create(null)
    var out = []
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i]
      if (!p || seen[p]) continue
      seen[p] = 1
      out.push(p)
    }
    return out
  }

  function collectDroppedPaths(dataTransfer) {
    if (!dataTransfer) return []
    var fromFiles = pathsFromFileList(dataTransfer.files)
    if (fromFiles.length) return dedupe(fromFiles)
    return dedupe(pathsFromUriList(dataTransfer))
  }

  function parentDir(filePath) {
    var p = String(filePath || '').replace(/[\\/]+$/, '')
    if (!p) return ''
    var i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
    if (i < 0) return ''
    if (i === 0) return p.charAt(0) === '/' ? '/' : ''
    var dir = p.slice(0, i)
    if (/^[A-Za-z]:$/.test(dir)) return dir + '\\'
    return dir
  }

  function hasLikelyFileExtension(filePath) {
    var base = String(filePath || '').split(/[/\\]/).pop() || ''
    return /\.[a-z0-9]{1,8}$/i.test(base)
  }

  function normDirKey(p) {
    return String(p || '').replace(/[\\/]+$/, '')
  }

  /** 拖入多项时，有多少条会落到与 chosenDir 不同的目录（同文件夹多文件不算） */
  function countForeignDropItems(paths, chosenDir) {
    var chosen = normDirKey(chosenDir)
    var seen = Object.create(null)
    if (chosen) seen[chosen] = 1
    var n = 0
    if (!paths || !paths.length) return 0
    for (var i = 0; i < paths.length; i++) {
      var p = String(paths[i] || '')
      var hint = hasLikelyFileExtension(p) ? parentDir(p) : p
      hint = normDirKey(hint)
      if (!hint || seen[hint]) continue
      seen[hint] = 1
      n += 1
    }
    return n
  }

  return {
    isExternalFileDrag: isExternalFileDrag,
    fileUrlToPath: fileUrlToPath,
    pathsFromFileList: pathsFromFileList,
    pathsFromUriList: pathsFromUriList,
    collectDroppedPaths: collectDroppedPaths,
    parentDir: parentDir,
    hasLikelyFileExtension: hasLikelyFileExtension,
    countForeignDropItems: countForeignDropItems,
  }
})
