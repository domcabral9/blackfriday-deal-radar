# Liga a VM do Deal Radar em modo headless, se ela ainda nao estiver rodando.
# Chamado pela tarefa agendada "DealRadar - Ligar VM" no logon do Windows.
# Os containers sobem sozinhos (Docker habilitado no boot + restart: unless-stopped).

param(
    [string]$VmName = 'n8n',
    [string]$SshHost = 'n8n-poc'
)

$VBox = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$LogDir = Join-Path $env:LOCALAPPDATA 'deal-radar'
$Log = Join-Path $LogDir 'vm.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start] $Message" | Out-File -FilePath $Log -Append -Encoding utf8
}

$info = & $VBox showvminfo $VmName --machinereadable 2>&1
$state = ($info | Select-String '^VMState="(.+)"').Matches.Groups[1].Value

if ($state -eq 'running') {
    Write-Log "VM ja estava rodando"
    exit 0
}

Write-Log "estado anterior: $state; ligando"
& $VBox startvm $VmName --type headless 2>&1 | ForEach-Object { Write-Log $_ }

# Espera o SSH responder e registra o estado dos containers
for ($i = 0; $i -lt 36; $i++) {
    Start-Sleep -Seconds 5
    $out = ssh -o BatchMode=yes -o ConnectTimeout=5 $SshHost "docker ps --format '{{.Names}} {{.Status}}'" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) {
        $out | ForEach-Object { Write-Log "container: $_" }
        exit 0
    }
}
Write-Log "SSH nao respondeu em 3 minutos"
exit 1
