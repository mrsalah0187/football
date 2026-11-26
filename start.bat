@echo off
chcp 65001 >nul
title METALS FOOTBALL CHAMPIONSHIP - Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js غير مثبّت. حمّله من https://nodejs.org ثم شغّل هذا الملف مرة أخرى.
  echo.
  pause
  exit /b
)
:: محاولة السماح للمنفذ في جدار الحماية (تنجح فقط عند التشغيل كمسؤول، وتُتجاهل إن فشلت)
netsh advfirewall firewall add rule name="Metals Football" dir=in action=allow protocol=TCP localport=3000 >nul 2>nul
node launch.js
echo.
echo الخادم توقف.
pause
