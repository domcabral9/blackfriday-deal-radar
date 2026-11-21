# Faz a VM do Deal Radar subir no boot do Windows, sem precisar de login.
# Rodar UMA vez, num PowerShell aberto como administrador:
#
#   powershell -ExecutionPolicy Bypass -File D:\Projects\00x0blackfriday\deploy\windows\install-autostart.ps1
#
# 1. Instala o servico oficial de autostart do VirtualBox para a sua conta.
#    A VM ja esta marcada com autostart-enabled=on, autostart-delay=30 e
#    autostop-type=AcpiShutdown (VBoxManage modifyvm).
# 2. Registra o watchdog para rodar mesmo com ninguem logado.
#
# A senha do Windows e pedida pelo proprio Windows e so fica guardada pelo
# gerenciador de servicos e pelo agendador de tarefas.

$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Abra o PowerShell como administrador e rode de novo.' -ForegroundColor Red
    exit 1
}

$VBoxDir = 'C:\Program Files\Oracle\VirtualBox'
$User = $env:USERNAME
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "`n[1/2] Servico de autostart do VirtualBox para '$User'" -ForegroundColor Cyan
Write-Host 'O VirtualBox vai pedir a sua senha do Windows.'
& "$VBoxDir\VBoxAutostartSvc.exe" install --user $User
Get-Service | Where-Object { $_.Name -like 'VBoxAutostartSvc*' } | ForEach-Object {
    Set-Service -Name $_.Name -StartupType Automatic
    Write-Host ("  servico {0}: {1}, inicio {2}" -f $_.Name, $_.Status, 'Automatic')
}

Write-Host "`n[2/2] Watchdog rodando mesmo sem login" -ForegroundColor Cyan
$cred = Get-Credential -UserName "$env:USERDOMAIN\$User" -Message 'Senha do Windows para o agendador de tarefas'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\watchdog-vm.ps1`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
Register-ScheduledTask -TaskName 'DealRadar - Watchdog VM' -Action $action -Trigger $trigger -Settings $settings `
    -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null
Write-Host '  tarefa DealRadar - Watchdog VM: registrada para rodar com ou sem login'

Write-Host "`nPronto. Para testar: reinicie o Windows e NAO faca login por ~4 minutos." -ForegroundColor Green
Write-Host 'O bot deve mandar "Radar online" com o notebook ainda na tela de login.'
