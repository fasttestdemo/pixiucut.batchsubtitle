;(function () {
  'use strict'

  var P = window.BatchSubtitlePlan
  var sdk = null
  var prefs = emptyPrefs()
  var rows = []
  var scanGen = 0
  var running = false
  var starting = false
  var scanning = false
  var stopRequested = false
  var activePath = ''
  var modelReady = false
  var modelBlocked = false
  var renderTimer = null

  function $(id) {
    return document.getElementById(id)
  }

  function emptyPrefs() {
    return { src: '', dest: '', includeSub: false, format: 'srt', overwrite: false }
  }

  function errCode(err) {
    return err && err.code
  }

  function notify(msg, type) {
    if (sdk && sdk.ui && sdk.ui.notify) sdk.ui.notify(msg, type || 'info').catch(function () {})
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function setRunning(on) {
    running = !!on
    document.querySelector('.plugin').classList.toggle('is-running', running)
    if (sdk && typeof sdk.setBusy === 'function') sdk.setBusy(running).catch(function () {})
    syncButtons()
  }

  function readFormat() {
    var value = $('format').value
    return value === 'txt' || value === 'both' ? value : 'srt'
  }

  function remember() {
    prefs.src = $('src').value.trim()
    prefs.dest = $('dest').value.trim()
    prefs.includeSub = !!$('sub').checked
    prefs.format = readFormat()
    prefs.overwrite = !!$('overwrite').checked
  }

  async function persist() {
    remember()
    if (!sdk) return
    try {
      var dir = await sdk.fs.dataDir()
      await sdk.fs.writeFile(P.joinPath(dir, 'config.json'), JSON.stringify(prefs), 'utf8')
    } catch (_) {
      /* 配置写失败不挡识别 */
    }
  }

  async function loadPrefs() {
    try {
      var dir = await sdk.fs.dataDir()
      var text = await sdk.fs.readFile(P.joinPath(dir, 'config.json'), 'utf8')
      var data = JSON.parse(text)
      if (!data || typeof data !== 'object') return emptyPrefs()
      var next = emptyPrefs()
      next.src = typeof data.src === 'string' ? data.src : ''
      next.dest = typeof data.dest === 'string' ? data.dest : ''
      next.includeSub = !!data.includeSub
      next.format = data.format === 'txt' || data.format === 'both' ? data.format : 'srt'
      next.overwrite = !!data.overwrite
      return next
    } catch (_) {
      return emptyPrefs()
    }
  }

  function setStat(text, kind) {
    var el = $('stat')
    el.textContent = text
    el.className = 'stat ' + (kind || 'idle')
  }

  function statusClass(status) {
    if (status === '完成') return 'ok'
    if (status === '失败' || status === '已停止') return 'err'
    if (status === '提取音频' || status === '识别中') return 'run'
    if (status === '已跳过' || status === '没有识别到人声') return 'skip'
    return 'wait'
  }

  function scheduleRender() {
    if (renderTimer) return
    renderTimer = setTimeout(function () {
      renderTimer = null
      renderList()
    }, 80)
  }

  function emptyHtml() {
    if (!prefs.src) {
      return (
        '<ol>' +
        '<li>选择原素材文件夹</li>' +
        '<li>列表里出现其中的视频和音频</li>' +
        '<li>点「开始识别」，字幕写入保存目录</li>' +
        '</ol>'
      )
    }
    return '<p>没有找到视频或音频</p>'
  }

  function renderList() {
    var card = $('files-card')
    var flist = $('flist')
    $('file-count').textContent = String(rows.length)
    if (!rows.length) {
      card.classList.add('is-empty')
      $('empty').innerHTML = emptyHtml()
    } else {
      card.classList.remove('is-empty')
      var keep = flist.scrollTop
      flist.innerHTML = rows
        .map(function (row) {
          var title = row.detail ? ' title="' + escapeHtml(row.detail) + '"' : ''
          return (
            '<div class="item">' +
            '<div class="name" title="' + escapeHtml(row.name) + '">' + escapeHtml(row.name) + '</div>' +
            '<div class="st ' + statusClass(row.status) + '"' + title + '>' + escapeHtml(row.status) + '</div>' +
            '<div class="pg"' + title + '>' + escapeHtml(row.progress || '—') + '</div>' +
            '</div>'
          )
        })
        .join('')
      flist.scrollTop = keep
    }
    syncButtons()
  }

  function syncButtons() {
    var canStart = !running && !starting && !scanning && modelReady && !modelBlocked && !!prefs.src && !!prefs.dest && rows.length > 0
    $('btn-start').disabled = !canStart
    $('btn-stop').disabled = !running || stopRequested
    $('btn-stop').textContent = stopRequested && running ? '正在停止…' : '停止识别'
  }

  function setBanner(text, warn) {
    var el = $('banner')
    el.textContent = text
    el.classList.toggle('warn', !!warn)
  }

  async function checkModel() {
    modelReady = false
    modelBlocked = false
    setBanner('正在检查本机语音模型…', false)
    try {
      var status = await sdk.asr.getStatus()
      if (status && status.localReady) {
        modelReady = true
        setBanner(P.READY_BANNER, false)
        syncButtons()
        return
      }
    } catch (err) {
      modelBlocked = true
      if (errCode(err) === 'HOST_DENIED') {
        setBanner('当前环境不能使用本机语音识别。请在桌面端打开本插件。', true)
      } else {
        setBanner(err && err.message ? err.message : '无法检查本机语音模型', true)
      }
      syncButtons()
      return
    }
    try {
      var missed = await sdk.asr.transcribe('')
      modelBlocked = true
      setBanner((missed && missed.message) || '请先在设置中下载本机语音模型。', true)
    } catch (err) {
      modelBlocked = true
      setBanner(err && err.message ? err.message : '请先在设置中下载本机语音模型。', true)
    }
    syncButtons()
  }

  async function walk(root, includeSub, skipDir) {
    var found = []
    async function step(dir) {
      var entries
      try {
        entries = await sdk.fs.readDir(dir)
      } catch (err) {
        if (errCode(err) === 'HOST_DENIED') throw err
        return
      }
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i]
        if (P.isDotName(entry.name)) continue
        var full = P.joinPath(dir, entry.name)
        if (entry.isDir) {
          if (skipDir && (P.samePath(skipDir, full) || P.isInside(skipDir, full))) continue
          if (includeSub) await step(full)
        } else if (P.isMediaName(entry.name)) {
          found.push(full)
        }
      }
    }
    await step(root)
    return found
  }

  async function scan() {
    if (running) return
    var gen = ++scanGen
    scanning = true
    syncButtons()
    try {
      rows = []
      renderList()
      if (!prefs.src) {
        setStat('未开始', 'idle')
        return
      }
      setStat('正在读取…', 'run')
      var files
      try {
        files = await walk(prefs.src, prefs.includeSub, P.saveDirToSkip(prefs.src, prefs.dest))
      } catch (err) {
        if (gen !== scanGen) return
        if (errCode(err) === 'HOST_DENIED') {
          $('files-card').classList.add('is-empty')
          $('empty').innerHTML = '<p>当前环境不能读取文件夹。请在桌面端打开本插件。</p>'
          setStat('未开始', 'idle')
          return
        }
        notify(err && err.message ? err.message : '扫描失败', 'error')
        setStat('未开始', 'idle')
        return
      }
      if (gen !== scanGen) return
      var accepted = []
      for (var i = 0; i < files.length; i += 1) {
        if (gen !== scanGen) return
        setStat('正在读取 ' + (i + 1) + '/' + files.length, 'run')
        try {
          var info = await sdk.media.probe(files[i])
          if (info && info.success && (info.type === 'video' || info.type === 'audio')) {
            accepted.push({
              name: P.displayName(prefs.src, files[i]),
              path: files[i],
              status: '等待',
              progress: '—',
              detail: '',
            })
            rows = accepted.slice()
            renderList()
          }
        } catch (err) {
          if (gen !== scanGen) return
          var code = errCode(err)
          if (code === 'HOST_DENIED' || code === 'ENGINE_UNAVAILABLE') {
            rows = []
            $('files-card').classList.add('is-empty')
            $('empty').innerHTML = '<p>' + escapeHtml(err.message || '无法读取素材信息') + '</p>'
            setStat('未开始', 'err')
            return
          }
        }
      }
      if (gen !== scanGen) return
      rows = accepted
      renderList()
      setStat(rows.length ? '共 ' + rows.length + ' 个文件' : '未开始', 'idle')
    } finally {
      if (gen === scanGen) {
        scanning = false
        syncButtons()
      }
    }
  }

  function findRow(filePath) {
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].path === filePath) return rows[i]
    }
    return null
  }

  async function fileExists(filePath) {
    try {
      return !!(await sdk.fs.exists(filePath))
    } catch (_) {
      return false
    }
  }

  async function writeText(filePath, text) {
    var dir = P.dirname(filePath)
    if (dir) await sdk.fs.mkdir(dir, true)
    await sdk.fs.writeFile(filePath, text, 'utf8')
  }

  function countStatus(status) {
    var n = 0
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].status === status) n += 1
    }
    return n
  }

  function finishNote(kind, text) {
    var done = countStatus('完成')
    var failed = countStatus('失败')
    setStat(text, kind)
    notify(text + '：完成 ' + done + '，失败 ' + failed, failed ? 'warning' : 'success')
  }

  async function runQueue() {
    var format = readFormat()
    var overwrite = !!$('overwrite').checked
    var total = rows.length
    var stoppedEarly = ''
    for (var i = 0; i < rows.length; i += 1) {
      if (stopRequested) {
        stoppedEarly = 'stop'
        break
      }
      var row = rows[i]
      row.detail = ''
      row.progress = '—'
      var paths = {
        srt: P.outputPath(prefs.src, prefs.dest, row.path, 'srt'),
        txt: P.outputPath(prefs.src, prefs.dest, row.path, 'txt'),
      }
      var exists = {
        srt: await fileExists(paths.srt),
        txt: await fileExists(paths.txt),
      }
      if (stopRequested) {
        stoppedEarly = 'stop'
        break
      }
      var pending = P.pendingExts(format, exists, overwrite)
      if (!pending.length) {
        row.status = '已跳过'
        renderList()
        continue
      }
      row.status = '提取音频'
      row.progress = '0%'
      activePath = row.path
      setStat('正在处理 ' + (i + 1) + '/' + total, 'run')
      renderList()
      var result
      try {
        result = await sdk.asr.transcribe(row.path)
      } catch (err) {
        activePath = ''
        if (stopRequested || errCode(err) === 'cancelled') {
          row.status = '已停止'
          row.progress = '—'
          stoppedEarly = 'stop'
          break
        }
        row.status = '失败'
        row.progress = err && err.message ? err.message : '失败'
        row.detail = row.progress
        renderList()
        continue
      }
      activePath = ''
      if (stopRequested || (result && result.code === 'cancelled')) {
        row.status = '已停止'
        row.progress = '—'
        stoppedEarly = 'stop'
        break
      }
      if (result && result.ok === false && result.code === 'busy') {
        row.status = '等待'
        row.progress = '—'
        stoppedEarly = 'busy'
        break
      }
      if (!result || result.ok === false) {
        row.status = '失败'
        row.detail = (result && result.message) || '识别失败'
        row.progress = row.detail
        renderList()
        continue
      }
      if (!P.hasSpeech(result)) {
        row.status = '没有识别到人声'
        row.progress = '—'
        renderList()
        continue
      }
      try {
        var wrote = false
        for (var k = 0; k < pending.length; k += 1) {
          var ext = pending[k]
          if (ext === 'srt') {
            var srt = typeof result.srt === 'string' ? result.srt : ''
            if (srt.trim()) {
              await writeText(paths.srt, srt)
              wrote = true
            }
          }
          if (ext === 'txt') {
            var txt = P.cuesToTxt(result.cues)
            if (txt.trim()) {
              await writeText(paths.txt, txt)
              wrote = true
            }
          }
        }
        if (!wrote) {
          row.status = '没有识别到人声'
          row.progress = '—'
        } else {
          row.status = '完成'
          row.progress = '100%'
        }
      } catch (err) {
        row.status = '失败'
        row.detail = err && err.message ? err.message : '写入失败'
        row.progress = row.detail
      }
      renderList()
    }
    activePath = ''
    if (stoppedEarly === 'busy') {
      setStat(P.BUSY_MESSAGE, 'err')
      notify(P.BUSY_MESSAGE, 'warning')
      return
    }
    if (stoppedEarly === 'stop' || stopRequested) {
      finishNote('err', '已停止')
      return
    }
    var failed = countStatus('失败')
    finishNote(failed ? 'err' : 'ok', failed ? '识别完成，失败 ' + failed + ' 条' : '识别完成')
  }

  function askOverwrite() {
    return new Promise(function (resolve) {
      var scrim = $('confirm')
      function close(ok) {
        scrim.hidden = true
        $('confirm-ok').onclick = null
        $('confirm-cancel').onclick = null
        resolve(ok)
      }
      $('confirm-ok').onclick = function () { close(true) }
      $('confirm-cancel').onclick = function () { close(false) }
      scrim.hidden = false
    })
  }

  async function start() {
    if (running || starting || scanning || !modelReady) return
    starting = true
    syncButtons()
    try {
      remember()
      if (!prefs.src || !prefs.dest || !rows.length) return
      if ($('overwrite').checked) {
        var ok = await askOverwrite()
        if (!ok) return
      }
      await persist()
      stopRequested = false
      for (var i = 0; i < rows.length; i += 1) {
        rows[i].status = '等待'
        rows[i].progress = '—'
        rows[i].detail = ''
      }
      renderList()
      setRunning(true)
      try {
        await runQueue()
      } finally {
        stopRequested = false
        activePath = ''
        setRunning(false)
        renderList()
      }
    } finally {
      starting = false
      syncButtons()
    }
  }

  async function stop() {
    if (!running || stopRequested) return
    stopRequested = true
    syncButtons()
    try {
      await sdk.asr.cancel()
    } catch (_) {
      /* 没有进行中的识别时取消也算成功；失败不挡循环停住 */
    }
  }

  async function resolveDroppedDirectory(event) {
    var FolderDrop = window.PluginFolderDrop
    if (!FolderDrop) return { dir: '', paths: [] }
    var paths = FolderDrop.collectDroppedPaths(event.dataTransfer)
    if (!paths.length) return { dir: '', paths: paths }
    var first = paths[0]
    try {
      var info = await sdk.fs.stat(first)
      if (info && info.isDir) return { dir: first, paths: paths }
      if (info && !info.isDir) {
        var parent = FolderDrop.parentDir(first)
        return parent ? { dir: parent, paths: paths, fromFile: true } : { dir: '', paths: paths }
      }
    } catch (_) {
      /* 读不到属性时按扩展名判断 */
    }
    if (!FolderDrop.hasLikelyFileExtension(first)) return { dir: first, paths: paths }
    var fallback = FolderDrop.parentDir(first)
    return fallback ? { dir: fallback, paths: paths, fromFile: true } : { dir: '', paths: paths }
  }

  async function applyDroppedDirectory(event, which) {
    if (running || starting) {
      notify('识别进行中，请结束后再设置目录', 'warning')
      return
    }
    var resolved = await resolveDroppedDirectory(event)
    if (!resolved.dir) {
      notify('未能读取拖入路径，请点击选择', 'warning')
      return
    }
    var FolderDrop = window.PluginFolderDrop
    var foreign = FolderDrop ? FolderDrop.countForeignDropItems(resolved.paths, resolved.dir) : 0
    var notes = []
    if (resolved.fromFile) notes.push('拖入的是文件，已使用它所在的目录')
    if (foreign) notes.push('已忽略另外 ' + foreign + ' 个不同目录')
    if (notes.length) notify(notes.join('；'), 'info')
    $(which).value = resolved.dir
    await persist()
    await scan()
  }

  function bindFolderDrop(el, which) {
    if (!el || el.getAttribute('data-drop-bound') === '1') return
    el.setAttribute('data-drop-bound', '1')
    var FolderDrop = window.PluginFolderDrop
    var depth = 0
    function isFile(ev) {
      return FolderDrop ? FolderDrop.isExternalFileDrag(ev) : false
    }
    function arm(ev) {
      if (!isFile(ev)) return false
      ev.preventDefault()
      ev.stopPropagation()
      return true
    }
    el.addEventListener('dragenter', function (ev) {
      if (!arm(ev)) return
      if (running || starting) return
      depth += 1
      el.classList.add('is-drop-target')
    })
    el.addEventListener('dragover', function (ev) {
      if (!arm(ev)) return
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = running || starting ? 'none' : 'copy'
      if (!running && !starting) el.classList.add('is-drop-target')
    }, true)
    el.addEventListener('dragleave', function (ev) {
      if (!isFile(ev)) return
      ev.preventDefault()
      ev.stopPropagation()
      depth = Math.max(0, depth - 1)
      if (depth === 0) el.classList.remove('is-drop-target')
    })
    el.addEventListener('drop', function (ev) {
      if (!arm(ev)) return
      depth = 0
      el.classList.remove('is-drop-target')
      applyDroppedDirectory(ev, which)
    }, true)
  }

  function swallowWindowFileDrop() {
    var FolderDrop = window.PluginFolderDrop
    function isFile(ev) {
      return FolderDrop ? FolderDrop.isExternalFileDrag(ev) : false
    }
    document.addEventListener('dragover', function (ev) {
      if (!isFile(ev)) return
      ev.preventDefault()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'none'
    })
    document.addEventListener('drop', function (ev) {
      if (!isFile(ev)) return
      ev.preventDefault()
    })
  }

  async function pickDir(which) {
    if (running) return
    var title = which === 'src' ? '选择原素材文件夹' : '选择结果保存文件夹'
    var current = which === 'src' ? prefs.src : prefs.dest
    var dir = await sdk.ui.pickDirectory({ title: title, defaultPath: current || undefined })
    if (!dir) return
    $(which).value = dir
    await persist()
    await scan()
  }

  async function boot() {
    sdk = window.PixiuCutPlugin
    if (!sdk) {
      setBanner('没有找到插件接口。请从 PixiuCut 首页打开本插件。', true)
      modelBlocked = true
      renderList()
      return
    }
    await sdk.ready()
    sdk.on('asr.progress', function (payload) {
      if (!activePath || stopRequested) return
      var row = findRow(activePath)
      if (!row) return
      row.status = P.statusFromPhase(payload && payload.phase)
      var percent = payload && typeof payload.percent === 'number' ? payload.percent : 0
      row.progress = percent + '%'
      scheduleRender()
    })
    prefs = await loadPrefs()
    $('src').value = prefs.src
    $('dest').value = prefs.dest
    $('sub').checked = prefs.includeSub
    $('format').value = prefs.format
    $('overwrite').checked = prefs.overwrite
    $('btn-pick-src').onclick = function () { pickDir('src') }
    $('btn-pick-dest').onclick = function () { pickDir('dest') }
    $('btn-open-dest').onclick = async function () {
      remember()
      if (!prefs.dest) {
        notify('请先选择保存目录', 'warning')
        return
      }
      try {
        await sdk.ui.showItemInFolder(prefs.dest)
      } catch (err) {
        notify(err && err.message ? err.message : '无法打开文件夹', 'error')
      }
    }
    $('sub').onchange = async function () {
      await persist()
      if (!running) await scan()
    }
    $('format').onchange = function () { persist() }
    $('overwrite').onchange = function () { persist() }
    $('btn-start').onclick = function () { start() }
    $('btn-stop').onclick = function () { stop() }
    bindFolderDrop($('src'), 'src')
    bindFolderDrop($('dest'), 'dest')
    swallowWindowFileDrop()
    renderList()
    await checkModel()
    if (prefs.src) await scan()
    else syncButtons()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot() })
  } else {
    boot()
  }
})()
