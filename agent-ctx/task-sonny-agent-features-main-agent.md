# Task ID: sonny-agent-features - main-agent

## Work Task
Implement comprehensive system information API, PC details display in main UI, improved folder selection with browse dialog, and robust error handling with retry logic for the Sonny Agent application.

## Files Modified/Created

### New Files Created:
1. `/src/app/api/system-info/route.ts` - System information API endpoint
2. `/src/app/api/folder-dialog/route.ts` - Folder dialog API endpoint
3. `/agent-ctx/task-sonny-agent-features-main-agent.md` - This file

### Modified Files:
1. `/src/app/page.tsx` - Main UI with system info display, improved folder selection, and error handling

## Key Features Implemented

### 1. System Information API (`/api/system-info`)
- Detects OS (Windows/macOS/Linux) with proper version names
- Returns RAM (total/available/usedPercent)
- Returns disk space for specified folder
- Returns architecture and detailed CPU info
- Shell detection including Git Bash/MINGW64

### 2. PC Details Display
- New System Information Card in empty state
- Visual progress bars for RAM and disk usage
- Color-coded: green (< 60%), yellow (60-80%), red (> 80%)
- CPU model, cores, and speed display

### 3. Improved Folder Selection
- Read-only styled input field
- "Browse" button with Search icon
- "Refresh" button for updating system info
- Disk space info displayed below folder input

### 4. Error Handling with Retry Logic
- Backend tracks retry attempts per step (max 3)
- Creates detailed ErrorReport objects on failure
- Returns `needsRetry` for retryable errors
- Returns `maxRetriesReached` when limit hit
- Frontend auto-retries with 1 second delay
- Error dialog shown when max retries reached
- Three user actions: Abort, Skip, Retry with Info

## API Response Examples

### System Info Response
```json
{
  "os": { "name": "Windows 11", "version": "10.0.22631", "platform": "win32" },
  "ram": { "total": 16, "available": 8.2, "usedPercent": 48 },
  "disk": { "total": 500, "free": 250, "usedPercent": 50, "selectedFolder": "C:\\Projects" },
  "architecture": "x86_64",
  "cpu": { "model": "Intel Core i7", "cores": 8, "speed": "3.60 GHz" },
  "shell": "Git Bash (MINGW64)"
}
```

### Error Response (needsRetry)
```json
{
  "success": false,
  "needsRetry": true,
  "stepIndex": 2,
  "currentAttempt": 1,
  "maxAttempts": 3,
  "errorReport": { ... }
}
```

### Error Response (maxRetriesReached)
```json
{
  "success": false,
  "maxRetriesReached": true,
  "userActionRequired": true,
  "options": ["provide_info", "skip_step", "abort"]
}
```

## Dependencies Used
- Existing shadcn/ui components (Dialog, AlertDialog, Button, Input, Badge, etc.)
- Lucide React icons (Monitor, Cpu, HardDrive, MemoryStick, Search, etc.)
- Node.js `os`, `fs`, `child_process` modules
