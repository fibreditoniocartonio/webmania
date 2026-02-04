@echo off
setlocal enabledelayedexpansion

:: Configurazione nome file di output
set "outputFile=progetto_completo.txt"

:: Svuota o crea il file di output
echo. > "%outputFile%"

echo Elaborazione file in corso...

:: 1. Elabora index.html (se esiste nella root)
if exist "index.html" (
    call :processFile "index.html" "html"
)

:: 2. Elabora file .js nella cartella javascript e sottocartelle
if exist "javascript" (
    for /r "javascript" %%F in (*.js) do (
        call :processFile "%%F" "javascript"
    )
)

:: 3. Elabora file .css nella cartella css e sottocartelle
if exist "css" (
    for /r "css" %%F in (*.css) do (
        call :processFile "%%F" "css"
    )
)

echo Operazione completata! Il file generato e: %outputFile%
pause
goto :eof

:: Funzione per formattare il contenuto
:processFile
set "fullPath=%~1"
set "lang=%~2"

:: Calcola il percorso relativo (sostituisce il percorso della cartella corrente con .)
set "relPath=!fullPath:%cd%=.!"
:: Normalizza i backslash in slash (opzionale, per stile web)
set "relPath=!relPath:\=/!"

echo Scrivendo: !relPath!

:: Scrittura nel file di output
(
    echo # !relPath!
    echo ```!lang!
    type "%fullPath%"
    echo ```
    echo.
) >> "%outputFile%"
goto :eof