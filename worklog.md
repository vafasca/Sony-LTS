# Sonny Agent - Work Log

---
## Task ID: system-info-and-error-handling - main-agent
### Work Task
Implement system information API, PC details display, improved folder selection UI, and error handling with retry logic.

### Work Summary

#### 1. Created `/api/system-info/route.ts` 
- Returns comprehensive system information including:
  - OS name and version (Windows, macOS, Linux)
  - RAM (total and available in GB) with usage percentage
  - Disk space (total and free in GB) for selected folder
  - Architecture (x86_64, etc.)
  - CPU info (model, cores, speed)
  - Shell detection (Git Bash/MINGW64, PowerShell, zsh, bash)
- Accepts optional `folder` query parameter to check disk space for specific folder
- Validates folder existence before returning info

#### 2. Updated Main Page UI (`/src/app/page.tsx`)
- Added System Information Card in the empty state showing:
  - Sistema Operativo (OS name)
  - Arquitectura (CPU architecture)
  - RAM Disponible (available/total with progress bar)
  - Disco Libre (free/total with progress bar)
  - Procesador (CPU model, cores, and speed)
- Progress bars use color coding: green (< 60%), yellow (60-80%), red (> 80%)
- Automatically fetches system info on component mount

#### 3. Created `/api/folder-dialog/route.ts`
- GET endpoint with multiple actions:
  - `common`: Returns common folder paths (home, desktop, documents, etc.)
  - `browse`: Opens native folder picker dialog (Windows only via PowerShell)
  - `list`: Lists subfolders of a given path
  - `validate`: Validates if a path exists and is a directory
- POST endpoint for creating new folders

#### 4. Improved Folder Selection UI
- Changed folder input to read-only styled input
- Added "Search" button to trigger folder browse dialog
- Added "Refresh" button to update system info for selected folder
- Shows disk space info below the folder input when folder is selected
- Uses `Search` icon for browse and `RefreshCw` icon for refresh

#### 5. Implemented Error Handling with Retry Logic in Process API
- Added `maxRetries = 3` for each step
- Tracks retry attempts per step in `retryAttempts` object
- When a command fails:
  - Creates detailed `ErrorReport` object with:
    - Phase, step, error message, exit code
    - Action executed, affected files
    - Previous attempts
    - Environment info (shell, package manager)
  - Returns `needsRetry: true` for retryable errors
  - Returns `maxRetriesReached: true` when 3 attempts fail
  - Returns `userActionRequired: true` with options: `provide_info`, `skip_step`, `abort`

#### 6. Updated Frontend Error Handling
- Added new state variables:
  - `systemInfo`: System information from backend
  - `currentError`: Current step error details
  - `showErrorDialog`: Controls error dialog visibility
  - `retryAttempts`: Tracks retry count per step
  - `userInputOnError`: User-provided additional info
- Updated `executeWithStreaming` function to:
  - Handle retry responses from backend
  - Show attempt count in terminal ("Intento X de 3")
  - Auto-retry with 1 second delay
  - Show error dialog when max retries reached
- Added Error Dialog (AlertDialog) with:
  - Red styling for error state
  - Phase and step information
  - Error message display
  - Retry count badge
  - Text area for additional user input
  - Three action buttons: "Abortar Todo", "Saltar Paso", "Reintentar con Info"

#### New Icons Added
- `Monitor` for OS display
- `Cpu` for architecture and CPU info
- `HardDrive` for disk space
- `MemoryStick` for RAM
- `Search` for folder browse
- `SkipForward` for skip step action

#### New TypeScript Interfaces
- `SystemInfo`: Backend system information structure
- `StepError`: Error details with retry count
- `ErrorUserAction`: User action types for error handling
