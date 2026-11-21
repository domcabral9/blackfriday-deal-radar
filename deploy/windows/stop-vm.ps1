# Desliga a VM de forma limpa (botao de energia ACPI) antes do Windows sair.
# Se o Ubuntu nao desligar a tempo, salva o estado da VM, que tambem e seguro
# para o filesystem. Desligamento abrupto ja corrompeu o journal ext4 desta VM
# uma vez, por isso o cuidado.
# Chamado pelo script de logoff do Windows (ver docs/DEVELOPMENT.md).

param(
    [string]$VmName = 'n8n',
    # Com o VirtualBox sobre o Hyper-V, o Ubuntu ja levou mais de 60 s para
    # desligar. Salvar o estado no meio do desligamento faz a VM terminar de
    # desligar logo depois de restaurada. O Windows espera ate 10 min por
    # scripts de logoff.
    [int]$TimeoutSeconds = 240
)

$VBox = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$LogDir = Join-Path $env:LOCALAPPDATA 'deal-radar'
$Log = Join-Path $LogDir 'vm.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [stop] $Message" | Out-File -FilePath $Log -Append -Encoding utf8
}

function Get-VmState {
    $info = & $VBox showvminfo $VmName --machinereadable 2>&1
    ($info | Select-String '^VMState="(.+)"').Matches.Groups[1].Value
}

# Durante o logoff, o servico do VirtualBox pode estar encerrando e a leitura
# do estado vir vazia. So desiste quando o estado diz claramente que a VM esta
# parada; qualquer outra coisa tenta o desligamento limpo.
$state = Get-VmState
if ($state -in @('poweroff', 'saved', 'aborted')) {
    Write-Log "VM ja estava parada ($state)"
    exit 0
}
Write-Log "estado lido: '$state'"

Write-Log "enviando ACPI power button"
& $VBox controlvm $VmName acpipowerbutton 2>&1 | Out-Null

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if ((Get-VmState) -eq 'poweroff') {
        Write-Log "VM desligada de forma limpa"
        exit 0
    }
}

Write-Log "timeout de ${TimeoutSeconds}s; salvando estado"
& $VBox controlvm $VmName savestate 2>&1 | ForEach-Object { Write-Log $_ }
exit 0
