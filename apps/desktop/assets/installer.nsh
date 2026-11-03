; The Windows installer's part in the app's links (src/deeplink.js): electron-builder's NSIS
; leaves `protocols` (electron-builder.yml) out, so this registers automagik:// and omni:// the
; way Windows reads a URL scheme: Software\Classes\<scheme>, for this user or the machine as
; the install chose. The app registers the same keys itself at each start
; (setAsDefaultProtocolClient); this makes the links work before the first start.
; Untested until Windows builds ship (#191).

!macro automagikRegisterScheme SCHEME
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SCHEME}" "" "URL:${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SCHEME}" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SCHEME}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SCHEME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

; Only a scheme that still opens this install is removed: another app may have taken it since.
!macro automagikUnregisterScheme SCHEME
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\${SCHEME}\shell\open\command" ""
  ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${SCHEME}"
  ${endIf}
!macroend

!macro customInstall
  !insertmacro automagikRegisterScheme automagik
  !insertmacro automagikRegisterScheme omni
!macroend

; An update runs the old uninstaller first and then installs again: the keys stay.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro automagikUnregisterScheme automagik
    !insertmacro automagikUnregisterScheme omni
  ${endIf}
!macroend
