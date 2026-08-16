# Деплой прокси на Яндекс Cloud Functions.
# Запуск: npm run deploy:proxy (или powershell -File proxy/deploy.ps1)
$ErrorActionPreference = 'Stop'
$proxyDir = $PSScriptRoot

# --- секреты из .env.deploy (НЕ в git) ---------------------------------------
$envFile = Join-Path $proxyDir '.env.deploy'
if (-not (Test-Path $envFile)) {
    Write-Error "Нет $envFile — скопируй .env.deploy.example и заполни"
}
$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.+?)\s*$') { $envVars[$Matches[1]] = $Matches[2] }
}
foreach ($k in 'GIGACHAT_AUTH_KEY', 'APP_KEY') {
    if (-not $envVars[$k]) { Write-Error "В .env.deploy не заполнен $k" }
}
if (-not $envVars['GIGACHAT_MODEL']) { $envVars['GIGACHAT_MODEL'] = 'GigaChat-2-Max' }

# --- zip ------------------------------------------------------------------
# Compress-Archive пишет '\' в именах записей — Linux в облаке такое не
# распакует как папку, поэтому собираем через .NET с прямыми слэшами.
$zip = Join-Path $env:TEMP 'pogreb-proxy.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($zip, 'Create')
foreach ($name in 'index.js', 'gigachat.js', 'vivino.js', 'parse.js', 'tiles.js', 'package.json') {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $proxyDir $name), $name) | Out-Null
}
[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $proxyDir 'certs\russiantrustedca.pem'), 'certs/russiantrustedca.pem') | Out-Null
$archive.Dispose()
Write-Output "Собран $zip"

# --- функция (создать при первом запуске) --------------------------------------
# PS 5.1: stderr нативной команды при EAP=Stop роняет скрипт — глушим на время проверки
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
yc serverless function get pogreb-proxy 2>&1 | Out-Null
$exists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEAP
if (-not $exists) {
    yc serverless function create --name pogreb-proxy | Out-Null
    Write-Output 'Функция pogreb-proxy создана'
}

$envArg = "GIGACHAT_AUTH_KEY=$($envVars['GIGACHAT_AUTH_KEY']),APP_KEY=$($envVars['APP_KEY']),GIGACHAT_MODEL=$($envVars['GIGACHAT_MODEL'])"
yc serverless function version create `
    --function-name pogreb-proxy `
    --runtime nodejs22 `
    --entrypoint index.handler `
    --memory 128m `
    --execution-timeout 60s `
    --source-path $zip `
    --environment $envArg
if ($LASTEXITCODE -ne 0) { Write-Error 'Не удалось создать версию функции' }

# публичный HTTP-вызов; наша защита — X-App-Key
yc serverless function allow-unauthenticated-invoke pogreb-proxy | Out-Null

$fn = yc serverless function get pogreb-proxy --format json | ConvertFrom-Json

# --- API Gateway: прямой вызов функции не принимает пути (/ai, /vivino) --------
$spec = [IO.File]::ReadAllText((Join-Path $proxyDir 'openapi.template.yaml')).Replace('{{FUNCTION_ID}}', $fn.id)
$specFile = Join-Path $env:TEMP 'pogreb-gw.yaml'
[IO.File]::WriteAllText($specFile, $spec, (New-Object System.Text.UTF8Encoding $false))

$ErrorActionPreference = 'SilentlyContinue'
yc serverless api-gateway get pogreb-gw 2>&1 | Out-Null
$gwExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEAP
if ($gwExists) {
    yc serverless api-gateway update pogreb-gw --spec $specFile | Out-Null
    Write-Output 'API Gateway обновлён'
} else {
    yc serverless api-gateway create --name pogreb-gw --spec $specFile | Out-Null
    Write-Output 'API Gateway pogreb-gw создан'
}

$gw = yc serverless api-gateway get pogreb-gw --format json | ConvertFrom-Json
Write-Output ''
Write-Output "URL прокси: https://$($gw.domain)"
