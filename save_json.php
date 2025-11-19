<?php
header('Content-Type: application/json; charset=UTF-8');

// === 診断: 警告も例外化してキャッチ、致命的エラーもJSONで返す ===
error_reporting(E_ALL);
ini_set('display_errors', 0);
$__stage = 'start';
set_error_handler(function($severity, $message, $file, $line){
  throw new ErrorException($message, 0, $severity, $file, $line);
});
register_shutdown_function(function() use (&$__stage){
  $e = error_get_last();
  if ($e && in_array($e['type'], [E_ERROR,E_PARSE,E_CORE_ERROR,E_COMPILE_ERROR,E_USER_ERROR])) {
    http_response_code(500);
    echo json_encode([
      "ok"=>false, "error"=>"fatal", "stage"=>$__stage,
      "message"=>$e['message']
    ], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
  }
});

function bail($code, $obj){
  http_response_code($code);
  echo json_encode($obj, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
  exit;
}

$secret_expected = '562664KChs'; // ★ admin.html の SAVE_SECRET と一致させる

// --- ヘルスチェック（動作確認用） ---
if (isset($_GET['health'])) { echo json_encode(["ok"=>true,"stage"=>"health"]); exit; }

$__stage = 'read_input';
$secret    = $_POST['secret']    ?? '';
$name      = $_POST['name']      ?? '';
$body      = $_POST['body']      ?? '';
$save_mode = $_POST['save_mode'] ?? 'overwrite'; // append | overwrite
$if_match  = $_POST['if_match']  ?? null;

if ($secret !== $secret_expected) bail(403, ["ok"=>false,"error"=>"forbidden"]);
if ($name === '')                 bail(400, ["ok"=>false,"error"=>"name required"]);

// --- manifest から解決 ---
$__stage = 'manifest';
$base = __DIR__;
$manifestPath = $base . '/data/manifest.json';
if (!is_file($manifestPath)) bail(500, ["ok"=>false,"error"=>"manifest missing"]);
$manifest = json_decode(file_get_contents($manifestPath), true);
if (!$manifest) bail(500, ["ok"=>false,"error"=>"manifest parse error"]);

$allowed = [];
foreach (($manifest['faqs'] ?? []) as $f){
  if (isset($f['key'],$f['file'])) $allowed[$f['key']] = $base.'/'.ltrim($f['file'],'/');
}
foreach (($manifest['other'] ?? []) as $o){
  if (isset($o['key'],$o['file'])) $allowed[$o['key']] = $base.'/'.ltrim($o['file'],'/');
}
$allowed['ui_texts'] = $base.'/data/ui_texts.json';

if (!isset($allowed[$name])) bail(400, ["ok"=>false,"error"=>"bad name","name"=>$name]);
$target = $allowed[$name];

// /data 配下のみ
$__stage = 'path_check';
$realTargetDir = realpath(dirname($target));
$dataRoot = realpath($base.'/data');
if ($realTargetDir===false || $dataRoot===false || strpos($realTargetDir, $dataRoot)!==0){
  bail(400, ["ok"=>false,"error"=>"path not allowed","target"=>$target]);
}
if (!is_dir(dirname($target)))      bail(500, ["ok"=>false,"error"=>"target dir missing"]);
if (!is_writable(dirname($target))) bail(500, ["ok"=>false,"error"=>"target dir not writable"]);

// --- 現行データ ---
$__stage = 'read_current';
$curTxt = is_file($target) ? file_get_contents($target) : '[]';
$cur = json_decode($curTxt, true);
if ($cur === null) $cur = []; // 壊れていたら空扱い
$curHash = hash('sha256', json_encode($cur, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));

// 競合検知
if ($if_match && $if_match !== $curHash){
  bail(409, ["ok"=>false,"error"=>"conflict","server_hash"=>$curHash]);
}

// --- バックアップ（失敗しても続行） ---
$__stage = 'backup';
$bakDir = $base . '/data/backups';
if (!is_dir($bakDir)) { @mkdir($bakDir, 0775, true); }
if (is_dir($bakDir) && is_writable($bakDir) && is_file($target)) {
  $ts = date('Ymd-His');
  @copy($target, "$bakDir/{$name}-$ts.json");
  $files = glob("$bakDir/{$name}-*.json");
  if (is_array($files)) {
    rsort($files);
    foreach (array_slice($files, 50) as $old) @unlink($old);
  }
}

// --- 正規化ヘルパ（mbstring 無しでも動く） ---
function norm_q($q){
  $s = $q ?? '';
  if (function_exists('mb_strtolower')) $s = mb_strtolower($s, 'UTF-8');
  else $s = strtolower($s);
  $s = preg_replace('/[？?！!。、「」、・…　\s]+/u', '', $s);
  return trim($s);
}

// --- append/overwrite ---
$__stage = 'merge';
if ($save_mode === 'append'){
  $adds = json_decode($body, true);
  if (!is_array($adds)) bail(400, ["ok"=>false,"error"=>"invalid body for append"]);

  if (is_array($cur)){
    // 配列想定（FAQ：オブジェクト配列 or 文字列配列）
    $isObjects = true;
    foreach ($cur as $e){ if (!is_array($e)) { $isObjects = false; break; } }

    if ($isObjects){
      $seen = [];
      foreach ($cur as $e){
        if (isset($e['id'])) $seen['id:'.$e['id']] = true;
        if (isset($e['q']))  $seen['q:'.norm_q($e['q'])] = true;
      }
      foreach ($adds as $e){
        if (!is_array($e)) continue;
        $k1 = isset($e['id']) ? 'id:'.$e['id'] : null;
        $k2 = isset($e['q'])  ? 'q:'.norm_q($e['q']) : null;
        if (($k1 && isset($seen[$k1])) || ($k2 && isset($seen[$k2]))) continue;
        $cur[] = $e;
        if ($k1) $seen[$k1] = true;
        if ($k2) $seen[$k2] = true;
      }
      $next = $cur;
    } else {
      // 文字列配列など
      $seen = [];
      foreach ($cur as $v){ $seen[(string)$v] = true; }
      foreach ($adds as $v){
        $k = (string)$v;
        if (!isset($seen[$k])){ $cur[] = $v; $seen[$k] = true; }
      }
      $next = $cur;
    }
  } else {
    // 既存がオブジェクト（ui_texts等）は append 非対応 → overwrite 扱い
    $data = json_decode($body, true);
    if ($data === null) bail(400, ["ok"=>false,"error"=>"invalid json"]);
    $next = $data;
  }

} else {
  $data = json_decode($body, true);
  if ($data === null) bail(400, ["ok"=>false,"error"=>"invalid json"]);
  $next = $data;
}

// --- 書き込み ---
$__stage = 'write';
$json = json_encode($next, JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
if ($json === false) bail(500, ["ok"=>false,"error"=>"encode failed"]);
if (file_put_contents($target, $json, LOCK_EX) === false){
  bail(500, ["ok"=>false,"error"=>"write failed","target"=>$target]);
}

$newHash = hash('sha256', json_encode($next, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
echo json_encode(["ok"=>true, "new_hash"=>$newHash], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
