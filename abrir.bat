@echo off
rem Sirve BN Map Explorer en http://127.0.0.1:8777 y abre el navegador.
cd /d "%~dp0"
start "" http://127.0.0.1:8777/index.html
python -m http.server 8777 --bind 127.0.0.1
