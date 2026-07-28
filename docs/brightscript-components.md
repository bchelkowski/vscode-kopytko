# BrightScript Component Reference

> **Last verified against Roku documentation:** 2026-07-28 (full method-by-method sweep of all interfaces)
>
> This date must be updated whenever the component catalog in
> `packages/brightscript-parser/src/catalog/components.ts` is refreshed.
> Rotate it after checking https://developer.roku.com/dev/docs/brightscript
> for new components, new interface methods, deprecations, or firmware version gates.
>
> The same date is exported as `CATALOG_LAST_VERIFIED` and surfaces in hover cards.

---

## How to update the catalog

1. Visit https://developer.roku.com/dev/docs/brightscript and navigate to the
   **BrightScript Component Reference** section.
2. Check each component page for:
   - New methods added since the last verification date
   - Methods marked deprecated (add `deprecated: true` + `deprecationNote`)
   - `since` firmware version tags on new methods
3. Edit `packages/brightscript-parser/src/catalog/components.ts` (npm package `kopytko-brightscript-parser`):
   - Add/modify entries in `BRIGHTSCRIPT_INTERFACES`
   - Add/modify entries in `BRIGHTSCRIPT_COMPONENTS`
   - Update `CATALOG_LAST_VERIFIED` to today's date (`YYYY-MM-DD`)
4. Add assertions in `test/brightscript/components.test.ts` covering any new methods.
5. Update this document's **Last verified** date above and the change-log below.

---

## Change log

| Date | Author | Summary |
|---|---|---|
| 2026-06-04 | Initial | Catalog created: 60 components, 78 interfaces, ~700 methods |
| 2026-07-07 | Docs sync | Catalog now at 62 components, 80 interfaces — added `roUtils`/`ifUtils` (firmware 15.0+) and documented `ifRenderThreadQueue` in the interfaces quick-reference |
| 2026-07-28 | Full audit | Every interface checked against its live Roku docs page. Removed 51 methods that were fabricated or filed under the wrong interface, added 14 documented ones that were missing, and wired `ifHttpAgent` onto `roUrlTransfer`. Method total 691 → 654. See the interface notes below for the renames. |
| 2026-07-28 | Audit follow-up | Two pre-existing tests expected `Values` on `roAssociativeArray` and `GetResponseCode` on `roUrlTransfer` — both were wrong (re-verified against the docs). `GetResponseCode`/`GetResponseHeaders`/`GetResponseHeadersArray` are real, but belong to `roUrlEvent`, the async-completion object delivered via message port — a component the catalog never had. Added `roUrlEvent`/`ifUrlEvent`. Catalog now 63 components, 81 interfaces, 662 methods. |

---

## Components

### Core data types

| Component | Interfaces | Description |
|---|---|---|
| `roArray` | ifArray, ifArrayGet, ifArraySet, ifArrayJoin, ifArraySort, ifArraySizeInfo, ifArraySlice, ifEnum | Dynamic array; the `[]` literal creates one |
| `roAssociativeArray` | ifAssociativeArray, ifEnum | Key-value dictionary; the `{}` literal creates one |
| `roString` | ifString, ifStringOps, ifToStr | Object wrapper for String with rich methods |
| `roInt` | ifInt, ifToStr | Object wrapper for Integer |
| `roFloat` | ifFloat, ifToStr | Object wrapper for Float |
| `roDouble` | ifDouble, ifToStr | Object wrapper for Double |
| `roBoolean` | ifBoolean, ifToStr | Object wrapper for Boolean |
| `roLongInteger` | ifLongInt, ifToStr | Object wrapper for 64-bit LongInteger |
| `roList` | ifList, ifArray, ifListToArray, ifEnum | Doubly-linked list |
| `roByteArray` | ifByteArray, ifArray, ifEnum, ifToStr | Binary buffer; supports file I/O, Base64, hex, CRC |
| `roFunction` | ifFunction, ifToStr | First-class function reference for callbacks |
| `roRegex` | ifRegex | POSIX regular expression matching, replacement, splitting |
| `roUtils` | ifUtils | Deep copy and object-identity comparison utilities *(since 15.0)* |

### XML

| Component | Interfaces | Description |
|---|---|---|
| `roXMLElement` | ifXMLElement | Parse and build XML; use `Parse(xmlString)` to load |
| `roXMLList` | ifXMLList, ifArray, ifEnum | List of XML elements returned by child queries |

### Date and time

| Component | Interfaces | Description |
|---|---|---|
| `roDateTime` | ifDateTime | UTC date/time; parse, format, arithmetic |
| `roTimespan` | ifTimespan | High-resolution elapsed timer |

### Network

| Component | Interfaces | Description |
|---|---|---|
| `roUrlTransfer` | ifUrlTransfer, ifHttpAgent, ifSetMessagePort, ifGetMessagePort | HTTP/HTTPS client; sync and async GET/POST. Header and cookie methods come from `ifHttpAgent` |
| `roUrlEvent` | ifUrlEvent | Response delivered via message port when an async `roUrlTransfer` request completes — response code, headers, and body live here, not on `roUrlTransfer` |
| `roHttpAgent` | ifHttpAgent | Shared HTTP agent managing cookies/headers across transfers |
| `roStreamSocket` | ifSocket, ifSocketAsync, ifSocketConnection, ifSocketConnectionOption, ifSocketConnectionStatus, ifSocketOption, ifSocketStatus, ifSetMessagePort, ifGetMessagePort | TCP stream socket |
| `roDataGramSocket` | ifSocket, ifSocketAsync, ifSocketOption, ifSocketStatus, ifSocketCastOption, ifSetMessagePort, ifGetMessagePort | UDP datagram socket with multicast support |
| `roSocketAddress` | ifSocketAddress | IP address and port for socket operations |

### Filesystem

| Component | Interfaces | Description |
|---|---|---|
| `roFileSystem` | ifFileSystem | Directory listing, copy, move, delete, stat |
| `roPath` | ifPath, ifString, ifStringOps | File path parsing and manipulation |

### Messaging

| Component | Interfaces | Description |
|---|---|---|
| `roMessagePort` | ifMessagePort | Event queue; use `WaitMessage()` in your main loop |
| `roRenderThreadQueue` | ifRenderThreadQueue | Queues messages for render-thread handlers; async Task-to-render communication (since 15.0) |

### Device and app

| Component | Interfaces | Description |
|---|---|---|
| `roDeviceInfo` | ifDeviceInfo, ifSetMessagePort, ifGetMessagePort | Model, OS, network, display, ad ID |
| `roAppInfo` | ifAppInfo | Channel manifest metadata |
| `roRegistry` | ifRegistry | Persistent storage — section management |
| `roRegistrySection` | ifRegistrySection | Per-section key-value read/write |
| `roAppManager` | ifAppManager | Uptime, screensaver, sign-in state, voice actions |
| `roAppMemoryMonitor` | ifAppMemoryMonitor, ifSetMessagePort, ifGetMessagePort | Memory-warning events and available memory queries |
| `roChannelStore` | ifChannelStore, ifSetMessagePort, ifGetMessagePort | In-channel purchasing and credential storage |
| `roRemoteInfo` | ifRemoteInfo | Paired remote model, wake state, and feature support |
| `roHdmiStatus` | ifHdmiStatus, ifSetMessagePort | HDMI connection state and HDCP status |
| `roCECStatus` | ifCECStatus, ifSetMessagePort, ifGetMessagePort | CEC bus status and active source query |
| `roInput` | ifInput, ifSetMessagePort, ifGetMessagePort | Deep-link and transport-control ECP events |
| `roLocalization` | ifLocalization | Locale-specific asset paths and plural string forms |
| `roSystemLog` | ifSystemLog, ifSetMessagePort, ifGetMessagePort | Structured log events for bandwidth/DRM monitoring |

### SceneGraph

| Component | Interfaces | Description |
|---|---|---|
| `roSGNode` | ifSGNode | Scene tree node; fields, children, focus, observers |
| `roSGScreen` | ifSGScreen, ifSetMessagePort, ifGetMessagePort | Top-level rendering surface |
| `roTextureManager` | ifTextureManager, ifHttpAgent, ifSetMessagePort, ifGetMessagePort | Async GPU texture loader for SceneGraph |
| `roTextureRequest` | ifTextureRequest, ifHttpAgent | Single texture load request issued to roTextureManager |

### Audio and video

| Component | Interfaces | Description |
|---|---|---|
| `roAudioPlayer` | ifAudioPlayer, ifHttpAgent, ifSetMessagePort, ifGetMessagePort | Background audio playback with playlist support |
| `roVideoPlayer` | ifVideoPlayer, ifHttpAgent, ifSetMessagePort, ifGetMessagePort | Video playback with seeking, audio tracks, captioning |
| `roAudioResource` | ifAudioResource | Short audio clip playback for UI sounds |
| `roAudioMetadata` | ifAudioMetadata | Reads ID3/Vorbis tags and cover art from audio files |
| `roImageMetadata` | ifImageMetadata | Reads EXIF metadata and thumbnails from image files |
| `roAudioGuide` | ifAudioGuide, ifSetMessagePort, ifGetMessagePort | Accessibility audio guide for visually impaired users |
| `roTextToSpeech` | ifTextToSpeech, ifSetMessagePort, ifGetMessagePort | Full TTS engine with language, voice, rate, pitch control |

### 2D Graphics

| Component | Interfaces | Description |
|---|---|---|
| `roScreen` | ifScreen, ifDraw2D, ifSetMessagePort, ifGetMessagePort | Low-level 2D drawing surface |
| `roBitmap` | ifDraw2D | Off-screen 2D surface for blitting to roScreen |
| `roRegion` | ifRegion | Rectangular sub-region of a bitmap; used as sprite frame |
| `roFont` | ifFont | Loaded font face for DrawText() calls |
| `roFontRegistry` | ifFontRegistry | Registers TTF/OTF fonts; vends roFont instances |
| `roCompositor` | ifCompositor, ifSetMessagePort, ifGetMessagePort | Z-ordered sprite compositor |
| `roSprite` | ifSprite | Single sprite managed by roCompositor |

### Cryptography

| Component | Interfaces | Description |
|---|---|---|
| `roEVPDigest` | ifEVPDigest | Message digests: MD5, SHA-1, SHA-256, SHA-512 |
| `roEVPCipher` | ifEVPCipher | Symmetric encryption: AES-128-CBC, AES-256-CBC |
| `roHMAC` | ifHMAC | HMAC authentication codes |
| `roDeviceCrypto` | ifDeviceCrypto | Device-bound encryption with hardware-backed key |
| `roRSA` | ifRSA | RSA asymmetric sign/verify with private/public key pairs |

---

## Interfaces quick-reference

| Interface | Key methods |
|---|---|
| `ifArray` | Push, Pop, Peek, Shift, Unshift, Delete, Count, Clear, Append |
| `ifArrayGet` | GetEntry |
| `ifArraySet` | SetEntry |
| `ifArrayJoin` | Join |
| `ifArraySort` | Sort, SortBy, Reverse |
| `ifArraySizeInfo` | Capacity, IsResizable |
| `ifArraySlice` | Slice *(since 10.0)* |
| `ifEnum` | Reset, Next, IsNext, Each |
| `ifAssociativeArray` | AddReplace, Clear, Delete, DoesExist, Items, Keys, Values, Lookup, LookupCI, Count, Append, SetModeCaseSensitive |
| `ifString` | SetString, GetString, ToStr |
| `ifStringOps` | Len, Left, Right, Mid, Instr, InstrRev, Replace, Trim, ToUpper, ToLower, Split, Tokenize, StartsWith, EndsWith, EncodeUri, DecodeUri, IsEmpty |
| `ifToStr` | ToStr |
| `ifInt` | GetInt, SetInt |
| `ifFloat` | GetFloat, SetFloat |
| `ifDouble` | GetDouble, SetDouble |
| `ifLongInt` | GetLongInt, SetLongInt |
| `ifBoolean` | GetBoolean, SetBoolean |
| `ifList` | AddTail, AddHead, RemoveTail, RemoveHead, GetTail, GetHead, RemoveIndex, Count, Clear, IsEmpty, ResetIndex, GetIndex |
| `ifByteArray` | WriteFile, ReadFile, AppendFile, SetResize, FromHexString, ToHexString, FromBase64String, ToBase64String, FromAsciiString, ToAsciiString, GetSignedByte, GetSignedLong, IsLittleEndianCPU, GetCRC32 |
| `ifXMLElement` | Parse, GetBody, GetAttributes, GetName, GetText, GetChildElements, GetChildCount, GetChild, GetChildByName, GetChildrenByName, AddChild, RemoveChild, Clear, GenXML, SetBody, SetName, AddAttribute, IsName, HasAttribute |
| `ifXMLList` | GetAttributes, GetBody, GetChildElements, GetName, GetText, Count, Simplify |
| `ifDateTime` | Mark, GetDayOfWeek, GetDayOfMonth, GetHours, GetMinutes, GetSeconds, GetMilliseconds, GetMonth, GetYear, GetWeekday, GetLastDayOfMonth, GetTimeZoneOffset, AsDateString, AsDateStringNoParam, asDateStringLoc, asTimeStringLoc, AsSeconds, AsSecondsLong, AsMillisecondsLong, FromSeconds, FromSecondsLong, ToLocalTime, ToISOString, FromISO8601String |
| `ifTimespan` | Mark, TotalMilliseconds, TotalSeconds |
| `ifUrlTransfer` | SetUrl, GetUrl, SetRequest, GetToString, GetToFile, AsyncGetToString, AsyncGetToFile, PostFromString, PostFromFile, AsyncPostFromString, AsyncPostFromFile, AsyncCancel, Head, AsyncHead, SetHeaders, AddHeader, GetResponseCode, GetResponseHeaders, GetResponseHeadersArray, GetFailureReason, EnablePeerVerification, EnableHostVerification, EnableFreshConnection, InitClientCertificates, SetMinimumTransferRate, SetCertificatesFile, EnableCookies, GetCookies, AddCookies, ClearCookies |
| `ifSetMessagePort` | SetMessagePort |
| `ifGetMessagePort` | GetMessagePort |
| `ifMessagePort` | WaitMessage, GetMessage, PeekMessage |
| `ifRenderThreadQueue` | AddMessageHandler, PostMessage, CopyMessage, NumCopies *(since 15.0)* |
| `ifFileSystem` | GetVolumeList, GetDirectoryListing, CreateDirectory, Delete, CopyFile, MoveFile, Rename, Exists, Stat, GetFreeSpace, MatchFiles, Find, FindRecurse |
| `ifPath` | Change, IsValid, Split, GetPath, GetParentPath, GetFilename, GetBasename, GetExtension |
| `ifDeviceInfo` | GetModel, GetModelDisplayName, GetFirmwareVersion, GetVersion, GetOSVersion, GetRIDA, IsRIDADisabled, GetChannelClientId, GetUserCountryCode, GetCurrentLocale, GetMemoryLevel, GetLinkStatus, GetInternetStatus, GetConnectionType, GetIPAddrs, GetConnectionInfo, GetDisplayType, GetDisplayMode, GetVideoMode, GetUIResolution, GetAudioOutputChannel, HasFeature, GetRandomUUID, GetCaptionsMode, SetCaptionsMode, GetClockFormat |
| `ifAppInfo` | GetID, IsDev, GetVersion, GetTitle, GetSubtitle, GetDevID, GetValue |
| `ifRegistry` | GetSectionList, Delete, Flush |
| `ifRegistrySection` | Read, ReadMulti, Write, WriteMulti, Delete, Exists, Flush, GetKeyList |
| `ifSGNode` | CreateChild, RemoveChild, GetParent, GetScene, GetChildCount, GetChild, GetChildren, AppendChild, InsertChild, ReplaceChild, RemoveChildIndex, FindNode, HasField, GetField, GetFields, SetField, SetFields, Update, ObserveField, ObserveFieldScoped, UnobserveField, UnobserveFieldScoped, GetType, SubType, IsSubtype, CallFunc, GetId, SetFocus, HasFocus, IsInFocusChain, GetFocusedChild, SignalBeacon, IsInSubtree |
| `ifSGScreen` | CreateScene, Show, Close, GetScene |
| `ifAudioPlayer` | Play, Stop, Pause, Resume, Next, SetContentList, AddContent, ClearContent, SetNext, Seek, SetLoop, SetTimedMetadataForKeys, GetPlaybackDuration, GetPlayheadPosition |
| `ifEVPDigest` | Setup, Update, Final, Process |
| `ifEVPCipher` | Setup, Process, Final, SetPadding |
| `ifHMAC` | Setup, Update, Final, Process |
| `ifListToArray` | ToArray |
| `ifVideoPlayer` | SetContentList, AddContent, ClearContent, Play, Stop, Pause, Resume, PreBuffer, SetNext, SetLoop, Seek, SetEnableAudio, GetAudioTracks, ChangeAudioTrack, SetDestinationRect, SetMaxVideoDecodeResolution, GetPlaybackDuration, SetPositionNotificationPeriod, SetTimedMetaDataForKeys, GetCaptionRenderer, SetCGMS |
| `ifAudioResource` | Trigger, IsPlaying, Stop, MaxSimulStreams, GetMetaData |
| `ifAudioMetadata` | SetUrl, GetTags, GetAudioProperties, GetCoverArt |
| `ifImageMetadata` | SetUrl, GetMetaData, GetThumbnail, GetRawExif, GetRawExifTag |
| `ifAudioGuide` | Say, Flush, Silence |
| `ifTextToSpeech` | Say, Silence, Flush, IsEnabled, GetAvailableLanguages, SetLanguage, GetLanguage, GetAvailableVoices, SetVoice, GetVoice, GetVolume, SetVolume, GetRate, SetRate, GetPitch, SetPitch |
| `ifHttpAgent` | AddHeader, SetHeaders, InitClientCertificates, SetCertificatesFile, SetCertificatesDepth, EnableCookies, GetCookies, AddCookies, ClearCookies |
| `ifSocket` | Send, SendStr, Receive, ReceiveStr, Close, SetAddress, GetAddress, SetSendToAddress, GetSendToAddress, GetReceivedFromAddress, GetCountRcvBuf, GetCountSendBuf, Status |
| `ifSocketAsync` | IsReadable, IsWritable, IsException, NotifyReadable, NotifyWritable, NotifyException, GetID |
| `ifSocketAddress` | SetAddress, GetAddress, SetHostName, GetHostName, SetPort, GetPort, IsAddressValid |
| `ifSocketConnection` | Connect, Listen, IsListening, Accept, IsConnected |
| `ifSocketConnectionOption` | GetKeepAlive, SetKeepAlive, GetLinger, SetLinger, GetMaxSeg, SetMaxSeg, GetNoDelay, SetNoDelay |
| `ifSocketConnectionStatus` | eConnAborted, eConnRefused, eConnReset, eIsConn, eNotConn |
| `ifSocketOption` | GetTTL, SetTTL, GetReuseAddr, SetReuseAddr, GetOOBInline, SetOOBInline, GetSendBuf, SetSendBuf, GetRcvBuf, SetRcvBuf, GetSendTimeout, SetSendTimeout, GetReceiveTimeout, SetReceiveTimeout |
| `ifSocketStatus` | eAgain, eAlready, eBadAddr, eDestAddrReq, eHostUnreach, eInvalid, eInProgress, eWouldBlock, eSuccess, eOK |
| `ifSocketCastOption` | GetBroadcast, SetBroadcast, JoinGroup, DropGroup, GetMulticastLoop, SetMulticastLoop, GetMulticastTTL, SetMulticastTTL |
| `ifDraw2D` | Clear, GetWidth, GetHeight, GetByteArray, GetPng, DrawRect, DrawPoint, DrawLine, DrawObject, DrawScaledObject, DrawRotatedObject, DrawTransformedObject, DrawText, Finish, GetAlphaEnable, SetAlphaEnable |
| `ifScreen` | SwapBuffers, GetGraphicsFeatures |
| `ifRegion` | GetBitmap, GetX, GetY, GetWidth, GetHeight, Offset, Set, Copy, SetWrap, GetWrap, SetTime, GetTime, SetPretranslation, GetPretranslationX, GetPretranslationY, SetScaleMode, GetScaleMode, SetCollisionType, GetCollisionType, SetCollisionRectangle, SetCollisionCircle |
| `ifFont` | GetOneLineHeight, GetOneLineWidth, GetAscent, GetDescent, GetMaxAdvance |
| `ifFontRegistry` | Register, GetFamilies, GetFont, GetDefaultFont, GetDefaultFontSize, Get |
| `ifCompositor` | SetDrawTo, Draw, DrawAll, NewSprite, NewAnimatedSprite, AnimationTick, ChangeMatchingRegions |
| `ifSprite` | MoveTo, MoveOffset, GetX, GetY, SetZ, GetZ, SetDrawableFlag, GetDrawableFlag, SetMemberFlags, GetMemberFlags, SetCollidableFlags, GetCollidableFlags, SetRegion, GetRegion, OffsetRegion, SetData, GetData, CheckCollision, CheckMultipleCollisions, Remove |
| `ifRegex` | IsMatch, Match, MatchAll, Replace, ReplaceAll, Split |
| `ifUtils` | DeepCopy, IsSameObject, IsComponentRegistered *(since 15.2)* |
| `ifLocalization` | GetLocalizedAsset, GetPluralString |
| `ifSystemLog` | EnableType |
| `ifAppManager` | GetUptime, GetScreensaverTimeout, SetUserSignedIn, SetAutomaticAudioGuideEnabled, IsAppInstalled, SetNowPlayingContentMetaData, StartVoiceActionSelectionRequest, SetVoiceActionStrings, GetLastExitInfo |
| `ifAppMemoryMonitor` | EnableMemoryWarningEvent, GetMemoryLimitPercent, GetChannelAvailableMemory, GetChannelMemoryLimit |
| `ifChannelStore` | GetIdentity, GetUserData, GetStoreCatalog, GetPurchaseList, DoOrder, FakeServer, GetPartialUserData, ConfirmOrder, StoreChannelCredData |
| `ifDeviceCrypto` | Encrypt, Decrypt |
| `ifRSA` | SetPrivateKey, SetPublicKey, SetDigestAlgorithm, Sign, Verify |
| `ifRemoteInfo` | GetModel, IsAwake, HasFeature |
| `ifHdmiStatus` | IsConnected, GetHdcpVersion, IsHdcpActive |
| `ifCECStatus` | IsActiveSource |
| `ifFunction` | GetSub, SetSub |
| `ifInput` | EnableTransportEvents, EventResponse |
| `ifTextureManager` | RequestTexture, CancelRequest, UnloadBitmap, Cleanup |
| `ifTextureRequest` | GetId, GetState, SetAsync, SetSize, SetScaleMode |

---

## Autocompletion coverage

The extension infers variable types from `CreateObject("roXxx")` calls and
typed function parameters (`param as roXxx`), then offers member completions
and hover documentation automatically. Full details are in
[language-server.md](./language-server.md).
