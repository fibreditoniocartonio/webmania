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
    echo Errore: File %filename% non trovato nella cartella corrente o nelle sottocartelle.
    pause
    exit /b
)

echo File trovato in: %foundFile%

rem --- 3. Lettura del file e ricerca versione ---
set "currentVersion="
for /f "tokens=2 delims==" %%A in ('findstr "GAME_VERSION" "%foundFile%"') do (
    set "lineValue=%%A"
    rem Rimuove spazi, virgolette e punto e virgola per estrarre solo il numero
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

rem --- 5. Scrittura del file modificato ---
rem Creiamo il nuovo contenuto in un file temporaneo
(
    echo export const GAME_VERSION = "%newVersion%";
) > "%foundFile%.tmp"

rem Sovrascrive il file originale
move /y "%foundFile%.tmp" "%foundFile%" >nul

echo Versione aggiornata con successo!
pause