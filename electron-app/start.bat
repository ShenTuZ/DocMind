@echo off
chcp 65001 > nul
set NODE_OPTIONS=--max-old-space-size=4096
npm start