# keep-awake.ps1
# Verhindert, dass Windows in den Energiesparmodus geht oder den Bildschirm
# abdunkelt, solange VS Code laeuft. Sobald VS Code geschlossen wird,
# kehrt das System zu seinem normalen Power-Verhalten zurueck.
#
# Aufruf: rechtsklick auf die Datei im Explorer -> "Mit PowerShell ausfuehren"
# oder in einem PowerShell-Fenster:  powershell -File scripts\keep-awake.ps1
#
# Beenden: Fenster schliessen oder Strg-C.

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PowerHelper {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
    public const uint ES_CONTINUOUS       = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED  = 0x00000001;
    public const uint ES_DISPLAY_REQUIRED = 0x00000002;
    public const uint ES_AWAYMODE_REQUIRED = 0x00000040;
}
"@

$KEEP_AWAKE = [PowerHelper]::ES_CONTINUOUS `
    -bor [PowerHelper]::ES_SYSTEM_REQUIRED `
    -bor [PowerHelper]::ES_DISPLAY_REQUIRED

$RELEASE = [PowerHelper]::ES_CONTINUOUS

$wasAwake = $false

function Test-VsCodeRunning {
    # Code.exe ist der Hauptprozess des VS-Code-Editors.
    # Auch "Code - Insiders.exe" beruecksichtigen, falls jemand das benutzt.
    $procs = Get-Process -ErrorAction SilentlyContinue -Name 'Code', 'Code - Insiders'
    return ($null -ne $procs) -and ($procs.Count -gt 0)
}

Write-Host '[keep-awake] gestartet. Strg-C zum Beenden.'
Write-Host '[keep-awake] solange VS Code laeuft, bleibt System + Display wach.'

try {
    while ($true) {
        $running = Test-VsCodeRunning
        if ($running -and -not $wasAwake) {
            [PowerHelper]::SetThreadExecutionState($KEEP_AWAKE) | Out-Null
            Write-Host ("[{0}] VS Code laeuft -> Sleep blockiert." -f (Get-Date -Format 'HH:mm:ss'))
            $wasAwake = $true
        }
        elseif (-not $running -and $wasAwake) {
            [PowerHelper]::SetThreadExecutionState($RELEASE) | Out-Null
            Write-Host ("[{0}] VS Code geschlossen -> Sleep wieder normal." -f (Get-Date -Format 'HH:mm:ss'))
            $wasAwake = $false
        }
        Start-Sleep -Seconds 15
    }
}
finally {
    # Sauber freigeben, falls das Skript beendet wird
    [PowerHelper]::SetThreadExecutionState($RELEASE) | Out-Null
    Write-Host '[keep-awake] beendet, Sleep-Verhalten zurueckgesetzt.'
}
