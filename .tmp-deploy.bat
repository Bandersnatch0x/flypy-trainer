@echo off
chcp 65001 >nul
cd /d D:\code_space\flypy-trainer
vercel --prod --yes --name flypy-trainer
