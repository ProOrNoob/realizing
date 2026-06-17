@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  Sutta Archive - Unbuild Script
::  Khoi phuc index.html ve che do dev (nhieu file JS rieng)
::  Usage:  unbuild.bat         (version tu file .buildver)
::          unbuild.bat 48      (chi dinh version)
:: ============================================================

if "%~1" neq "" (
    set "VER=%~1"
) else if exist .buildver (
    set /p VER=<.buildver
) else (
    set "VER=48"
)

echo [UNBUILD] Restoring index.html to dev mode (v!VER!)

:: Thay 1 the bundle bang 9 the script (dung PowerShell cho an toan)
set "BUILDVER=!VER!"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$v=$env:BUILDVER; $f=(Resolve-Path index.html).Path; $h=[System.IO.File]::ReadAllText($f); $q=[char]34; $nl= if($h.Contains([char]13)){[char]13+[char]10}else{[char]10}; $names=@('toc.js','js/utils.js','js/bilara.js','js/state.js','js/ui.js','js/anchor.js','js/render.js','js/menu.js','js/tts.js'); $tags=($names | ForEach-Object {'<script src='+$q+$_+'?v='+$v+$q+' defer></script>'}) -join $nl; $bundle='<script src=.app\.bundle\.js\?v=\d+. defer></script>'; $block='(?s)<script src=.toc\.js\?v=\d+. defer></script>.*?<script src=.js/tts\.js\?v=\d+. defer></script>'; if($h -match $bundle){ $h=[regex]::Replace($h,$bundle,$tags) } elseif($h -match $block){ $h=[regex]::Replace($h,$block,$tags); Write-Host '[UNBUILD] index.html da o che do dev - chi cap nhat version' } else { Write-Host '[ERROR] Khong tim thay script trong index.html'; exit 1 }; [System.IO.File]::WriteAllText($f,$h,(New-Object System.Text.UTF8Encoding $false))"
if errorlevel 1 (
    echo [ERROR] Failed to update index.html!
    exit /b 1
)

echo [UNBUILD] Restored 9 script tags in index.html
echo [DONE] Dev mode ready - run local server to test

endlocal
