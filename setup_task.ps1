$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "C:\Users\rajdi\llm_council\background_manager.vbs"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet
$settings.DisallowStartIfOnBatteries = $false
$settings.StopIfGoingOnBatteries = $false
Register-ScheduledTask -TaskName "LLM_COUNCIL_Autostart" -Action $action -Trigger $trigger -Settings $settings -Description "Starts LLM_COUNCIL in background. Automatically manages execution based on power state (kills after 5 mins on battery)." -Force
