@echo off
setlocal enabledelayedexpansion

set "filename=version.js"
set "foundFile="

echo Cerco il file %filename%...

rem --- 1. Ricerca nella cartella corrente ---
if exist "%filename%" (
    set "foundFile=%filename%"
) else (
    rem --- 2. Ricerca nelle sottocartelle (solo 1 livello) ---
    for /d %%D in (*) do (
        if exist "%%D\%filename%" (
            set "foundFile=%%D\%filename%"
            goto :process
        )
    )
)

:process
if "%foundFile%"=="" (
    echo Errore: File %filename% non trovato.
    pause
    exit /b
)

echo File trovato in: %foundFile%

rem --- 3. Lettura del file e ricerca versione attuale ---
set "currentVersion="
for /f "tokens=2 delims==" %%A in ('findstr "GAME_VERSION" "%foundFile%"') do (
    set "lineValue=%%A"
    set "lineValue=!lineValue: =!"
    set "lineValue=!lineValue:"=!"
    set "lineValue=!lineValue:;=!"
    set "currentVersion=!lineValue!"
)

if "%currentVersion%"=="" (
    echo Errore: Non ho trovato la variabile GAME_VERSION nel file.
    pause
    exit /b
)

echo La versione attuale e: %currentVersion%

rem --- 4. Incremento della versione ---
set /a newVersion=%currentVersion% + 1
echo Incremento la versione a: %newVersion%

rem --- 5. Scrittura del file modificato PRESERVANDO le altre righe ---
rem Usiamo un file temporaneo per ricostruire il file originale riga per riga
if exist "%foundFile%.tmp" del "%foundFile%.tmp"

for /f "usebackq delims=" %%L in ("%foundFile%") do (
    set "line=%%L"
    
    rem Controlliamo se la riga contiene GAME_VERSION (ma non MIN_TRACK_VERSION...)
    echo !line! | findstr /C:"GAME_VERSION" >nul
    if !errorlevel! equ 0 (
        rem Se e la riga della versione, scriviamo quella nuova
        echo export const GAME_VERSION = "%newVersion%";>> "%foundFile%.tmp"
    ) else (
        rem Altrimenti scriviamo la riga originale cosi com'e
        echo !line!>> "%foundFile%.tmp"
    )
)

rem Sovrascrive il file originale con quello temporaneo
move /y "%foundFile%.tmp" "%foundFile%" >nul

echo Versione aggiornata con successo nel file %foundFile%
pause