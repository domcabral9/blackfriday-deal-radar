# Watchdog da VM do Deal Radar, rodado pelo Windows a cada 5 minutos.
#
# Cobre o ponto cego do healthcheck interno: quando a VM inteira trava, o n8n
# trava junto e ninguem avisa. Este script roda fora da VM e decide:
#   - disco da VM em somente leitura (journal do ext4 abortado) -> reset
#   - VM ligada mas sem SSH por 3 verificacoes seguidas (~15 min) -> reset
# Depois do reset, os containers sobem sozinhos e o bot manda "Radar online".
#
# Contexto: com o VirtualBox rodando sobre o Hyper-V (modo NEM), a VM chega a
# ficar minutos sem CPU. Uma gravacao em disco expira e o Linux trava o disco
# em somente leitura por protecao. Ver docs/DEVELOPMENT.md.

param(
    [string]$VmName = 'n8n',
    [string]$SshHost = 'n8n-poc',
    [int]$MaxSshFailures = 3
)

$VBox = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$LogDir = Join-Path $env:LOCALAPPDATA 'deal-radar'
$Log = Join-Path $LogDir 'vm.log'
$StateFile = Join-Path $LogDir 'watchdog-ssh-failures.txt'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [watchdog] $Message" | Out-File -FilePath $Log -Append -Encoding utf8
}

function Reset-Vm([string]$Reason) {
    Write-Log "RESET: $Reason"
    & $VBox controlvm $VmName reset 2>&1 | ForEach-Object { Write-Log $_ }
    Set-Content -Path $StateFile -Value 0
}

$info = & $VBox showvminfo $VmName --machinereadable 2>&1
$state = ($info | Select-String '^VMState="(.+)"').Matches.Groups[1].Value
if ($state -ne 'running') { exit 0 }   # desligada de proposito: nao interferir

$probe = ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost 'touch /tmp/.radar-rw-probe && echo RW_OK || echo RW_FAIL' 2>$null
$sshOk = ($LASTEXITCODE -eq 0) -and $probe

if ($sshOk) {
    Set-Content -Path $StateFile -Value 0
    if ($probe -match 'RW_FAIL') { Reset-Vm 'disco da VM em somente leitura' }
    exit 0
}

$failures = 0
if (Test-Path $StateFile) { [int]::TryParse((Get-Content $StateFile -Raw).Trim(), [ref]$failures) | Out-Null }
$failures++
Set-Content -Path $StateFile -Value $failures
Write-Log "SSH sem resposta ($failures de $MaxSshFailures)"
if ($failures -ge $MaxSshFailures) { Reset-Vm "SSH sem resposta por $failures verificacoes" }
