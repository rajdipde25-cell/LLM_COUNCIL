$projectPath = "C:\Users\rajdi\freellmapi"
$batteryMinutes = 0

# Ensure the log file is created in a temp folder or project folder
$logFile = "$projectPath\power_monitor.log"
"Starting power monitor at $(Get-Date)" | Out-File -FilePath $logFile -Append

while ($true) {
    $isOnAC = $true
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $status = [System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus
        if ($status -eq 'Offline') {
            $isOnAC = $false
        }
    } catch {
        # Fallback to WMI if .NET fails
        $wmiBattery = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue
        if ($wmiBattery) {
            if ($wmiBattery.BatteryStatus -eq 1) {
                $isOnAC = $false
            }
        }
    }
    
    # Get all node processes
    $nodeProcesses = Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'"
    $isRunning = $false
    foreach ($p in $nodeProcesses) {
        if ($p.CommandLine -and ($p.CommandLine -like "*freellmapi*" -or $p.CommandLine -like "*llm_council*")) {
            $isRunning = $true
        }
    }
    
    if ($isOnAC) {
        if ($batteryMinutes -gt 0) {
            "Power status: Connected to AC. Resetting battery timer." | Out-File -FilePath $logFile -Append
        }
        $batteryMinutes = 0
        if (-not $isRunning) {
            "Starting server on AC power..." | Out-File -FilePath $logFile -Append
            Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d $projectPath && npm run dev" -WindowStyle Hidden
        }
    } else {
        $batteryMinutes += 1
        "Power status: Running on battery. Minutes unplugged: $batteryMinutes" | Out-File -FilePath $logFile -Append
        if ($batteryMinutes -ge 5) {
            if ($isRunning) {
                "Running on battery for 5+ minutes. Stopping server..." | Out-File -FilePath $logFile -Append
                foreach ($p in $nodeProcesses) {
                    if ($p.CommandLine -and ($p.CommandLine -like "*freellmapi*" -or $p.CommandLine -like "*llm_council*")) {
                        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
                    }
                }
            }
        }
    }
    
    Start-Sleep -Seconds 60
}
