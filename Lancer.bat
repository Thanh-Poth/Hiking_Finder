@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Bivouac

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Installez la version LTS depuis https://nodejs.org puis relancez ce fichier.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Premiere utilisation : installation des dependances, patientez...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo L'installation a echoue.
    pause
    exit /b 1
  )
)

echo L'application s'ouvre dans votre navigateur (http://localhost:5290).
echo Fermez cette fenetre pour l'arreter.
call npm start
