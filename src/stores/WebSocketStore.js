import { observable } from 'mobx'
import { AlertIOS, AsyncStorage, DeviceEventEmitter, NativeModules, Platform } from 'react-native'
const { DeviceInfo } = NativeModules

export const TEST_IP_ADDRESS = '192.168.1.60'
export const TEST_PORT = 5672

export default class WebSocketStore {
  searchStore
  themeStore
  trackStore
  libraryStore
  @observable ipAddress
  @observable port
  @observable webSocket = null
  @observable isConnecting = false
  @observable isConnected = false
  @observable lastMessage = null
  shouldReconnect = false
  awaitingCode

  constructor (trackStore, themeStore, searchStore, libraryStore, port = TEST_PORT) {
    this.searchStore = searchStore
    this.trackStore = trackStore
    this.themeStore = themeStore
    this.libraryStore = libraryStore
    this.port = port
    this.awaitingCode = false

    this.hook()
  }

  hook = () => {
    DeviceEventEmitter.addListener('volume_up', () => {
      if (this.isConnected) {
        this._sendMessage({ namespace: 'volume', method: 'increaseVolume' })
      }
    })
    DeviceEventEmitter.addListener('volume_down', () => {
      if (this.isConnected) {
        this._sendMessage({ namespace: 'volume', method: 'decreaseVolume' })
      }
    })
  }

  connect (ip) {
    ip = ip.trim() // eslint-disable-line
    if (!ip) {
      return
    }
    this.isConnecting = true
    try {
      this.ipAddress = ip
      this.webSocket = new WebSocket(`ws://${this.ipAddress}:${this.port}`)
      this.shouldReconnect = true
    } catch (err) {
      this.disconnect()
    }
    this.webSocket.onopen = this._onConnectionOpen
    this.webSocket.onerror = this._onConnectioError
    this.webSocket.onmessage = this._onMessage
    this.webSocket.onclose = this._onConnectionClose
  }

  disconnect = () => {
    this.shouldReconnect = false
    this.webSocket.close()
    this.webSocket = null
  }

  _onConnectionOpen = () => {
    this.isConnecting = false
    this.isConnected = true
    DeviceInfo.getDeviceName()
      .then((deviceName) => {
        AsyncStorage.getItem('AUTH_CODE')
          .then((value) => {
            this.awaitingCode = false
            this._sendMessage({ namespace: 'connect', method: 'connect', arguments: [deviceName, value] })
          })
          .catch(() => {})
      })
  }

  _onConnectionError = (error) => {
    this.isConnecting = false
    this.isConnected = false
  }

  _onConnectionClose = () => {
    this.isConnecting = false
    this.isConnected = false

    // Reset the trackStore
    this.trackStore.reset()

    if (this.shouldReconnect) {
      this.connect(this.ipAddress)
    }
  }

  _onMessage = (msg) => {
    this.lastMessage = msg
    const { channel, payload } = JSON.parse(msg.data)
    switch (channel) {
      case 'connect': {
        if (payload === 'CODE_REQUIRED') {
          if (this.awaitingCode) break
          this.awaitingCode = true
          let userInputPromise
          if (Platform.OS === 'android') {
            userInputPromise = DeviceInfo.dialog(
              'GPMDP Code Required',
              'Input the 4 digit code that GPMDP is displaying on screen',
              'Authenticate'
            )
          } else {
            userInputPromise = new Promise((resolve, reject) => {
              AlertIOS.prompt(
                'GPMDP Code Required',
                'Input the 4 digit code that GPMDP is displaying on screen',
                text => resolve(text),
                'plain-text',
                'Authenticate'
              )
            })
          }
          userInputPromise.then((val) => {
            this._sendMessage({ namespace: 'connect', method: 'connect', arguments: ['_', val] })
            this.awaitingCode = false
          })
          .catch(() => {
            this.awaitingCode = false
          })
        } else {
          AsyncStorage.setItem('AUTH_CODE', payload)
            .then(this._onConnectionOpen)
            .catch(() => {})
        }
        break
      }
      case 'track': {
        const { title, artist, album } = payload
        const albumArt = payload.albumArt && payload.albumArt.replace(/=s90-c-e100$/g, '')
        this.trackStore.changeTrack(title, artist, album, albumArt)
        this.trackStore.start()
        break
      }
      // API is glitched in an old release.  We should leave this here for historical reasons
      case 'playState':
      case 'state': {
        const isPlaying = payload
        this.trackStore.setPlayingStatus(isPlaying)
        break
      }
      case 'playback-time':
      case 'time': {
        this.trackStore.updateTime(payload.current, payload.total)
        this.trackStore.start()
        break
      }
      case 'shuffle': {
        this.trackStore.updateShuffleMode(payload)
        break
      }
      case 'repeat': {
        this.trackStore.updateRepeatMode(payload)
        break
      }
      case 'playlists': {
        this.trackStore.updatePlaylists(payload)
        break
      }
      case 'queue': {
        this.trackStore.updateQueue(payload)
        break
      }
      case 'search-results': {
        this.searchStore.setSearchText(payload.searchText)
        this.searchStore.setSearchResults(payload)
        break
      }
      case 'library': {
        this.libraryStore.setLibrary(payload)
        break
      }
      case 'settings:theme': {
        this.themeStore.setThemeEnabled(payload)
        this.trackStore.forceUpdatePlaylists()
        break
      }
      case 'settings:themeType': {
        this.themeStore.setThemeType(payload)
        this.trackStore.forceUpdatePlaylists()
        break
      }
      case 'settings:themeColor': {
        this.themeStore.setThemeColor(payload)
        break
      }
      default: {
        if (channel === 'lyrics') return
        console.log(`WebSocket message received, channel: ${channel}, payload: ${payload}`)
        break
      }
    }
  }

  sendPlay = () => {
    this._sendMessage({ namespace: 'playback', method: 'playPause' })
  }

  sendPlayPlaylistTrack = (playlist, track) => {
    this._sendMessage({ namespace: 'playlists', method: 'playWithTrack', arguments: [playlist, track] })
  }

  sendPlayPlaylist = (playlist) => {
    this._sendMessage({ namespace: 'playlists', method: 'play', arguments: [playlist] })
  }

  sendPlayQueueTrack = (track) => {
    this._sendMessage({ namespace: 'queue', method: 'playTrack', arguments: [track] })
  }

  sendPrev = () => {
    this._sendMessage({ namespace: 'playback', method: 'rewind' })
  }

  sendNext = () => {
    this._sendMessage({ namespace: 'playback', method: 'forward' })
  }

  sendGetShuffle = () => {
    this._sendMessage({ namespace: 'playback', method: 'getShuffle' })
  }

  sendToggleShuffle = () => {
    this._sendMessage({ namespace: 'playback', method: 'toggleShuffle' })
  }

  sendGetRepeat = () => {
    this._sendMessage({ namespace: 'playback', method: 'getRepeat' })
  }

  sendLibraryPlayTrack = (track) => {
    this._sendMessage({ namespace: 'library', method: 'playTrack', arguments: [track] })
  }

  sendToggleRepeat = () => {
    this._sendMessage({ namespace: 'playback', method: 'toggleRepeat' })
  }

  sendSearch = (searchText) => {
    this._sendMessage({ namespace: 'search', method: 'performSearch', arguments: [searchText] })
  }

  sendSearchAndPlayResult = (searchText, result) => {
    this._sendMessage({ namespace: 'search', method: 'performSearchAndPlayResult', arguments: [searchText, result] })
  }

  sendSetTime = (time) => {
    this._sendMessage({ namespace: 'playback', method: 'setCurrentTime', arguments: [time] })
    this.trackStore.stop()
  }

  _sendMessage = (msg) => {
    if (this.webSocket.readyState === 1) {
      this.webSocket.send(JSON.stringify(msg))
    }
  }

}
