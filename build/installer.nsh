; installer.nsh - EasyGit additions to the electron-builder NSIS installer.
;
; In-app updates run the new installer silently with --easygit-restart (see
; launchUpdate in src/main/main.js). After the files are installed, start the
; updated EasyGit directly. electron-builder's own --force-run relaunch goes
; through a shell API (StdUtils.ExecShellAsUser) that silently does nothing on
; some Windows setups, which would leave the user with no EasyGit window.
!macro customInstall
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--easygit-restart" $R1
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  ${EndIf}
!macroend
