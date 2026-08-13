const {
  DEFAULT_SERVERS,
  CUSTOM_SERVER,
  parseServerUrl,
  buildServerUrl,
  buildSocketUrl,
  matchServerPreset,
  formatMetric,
  fetchStates,
  callSwitchService,
  connectHomeAssistantSocket,
} = require('../../utils/home-assistant');

const CUSTOM_NAME_STORAGE_KEY = 'phicomm_dc1.customNames';
const DEFAULT_SERVER = DEFAULT_SERVERS[0];

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function formatClock(date = new Date()) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((item) => String(item).padStart(2, '0'))
    .join(':');
}

function buildServerView(fields) {
  const serverProtocol = String((fields && fields.serverProtocol) || 'https').toLowerCase();
  const serverHost = String((fields && fields.serverHost) || '');
  const serverPort = String((fields && fields.serverPort) || '');
  const normalizedPort = serverPort.trim() || '8123';
  const matched = matchServerPreset({
    protocol: serverProtocol,
    host: serverHost.trim(),
    port: normalizedPort,
  });
  const serverTarget = {
    protocol: serverProtocol,
    host: serverHost.trim(),
    port: normalizedPort,
  };

  return {
    serverProtocol,
    serverHost,
    serverPort: serverPort,
    baseUrl: buildServerUrl(serverTarget),
    wsUrl: buildSocketUrl(serverTarget),
    selectedServerId: matched.id,
  };
}

Page({
  data: {
    serverPresets: DEFAULT_SERVERS,
    selectedServerId: DEFAULT_SERVER.id,
    serverProtocol: DEFAULT_SERVER.protocol,
    serverHost: DEFAULT_SERVER.host,
    serverPort: DEFAULT_SERVER.port,
    baseUrl: buildServerUrl(DEFAULT_SERVER),
    wsUrl: buildSocketUrl(DEFAULT_SERVER),
    token: '',
    showToken: false,
    tokenLength: 0,
    cleanTokenLength: 0,
    tokenHasWhitespace: false,
    settingsOpen: true,
    loading: false,
    wsConnected: false,
    mainDevice: null,
    outlets: [],
    errorText: '',
    lastUpdated: '',
    customNames: {},
    renameDialogVisible: false,
    renameTargetId: '',
    renameInput: '',
  },

  onLoad() {
    const storedUrl = wx.getStorageSync('phicomm_dc1.baseUrl') || '';
    const token = wx.getStorageSync('phicomm_dc1.token') || '';
    const customNames = ensureObject(wx.getStorageSync(CUSTOM_NAME_STORAGE_KEY));
    const parsed = storedUrl ? parseServerUrl(storedUrl) : DEFAULT_SERVER;
    const serverView = buildServerView({
      serverProtocol: parsed.protocol,
      serverHost: parsed.host || DEFAULT_SERVER.host,
      serverPort: parsed.port || DEFAULT_SERVER.port,
    });

    this.setData(
      Object.assign({}, serverView, {
        token,
        tokenLength: token.length,
        cleanTokenLength: this.getSanitizedToken(token).length,
        tokenHasWhitespace: /\s/.test(token),
        customNames,
        settingsOpen: !token,
      })
    );

    if (serverView.baseUrl && token) {
      this.connectAndRefresh();
    }
  },

  onUnload() {
    this.closeSocket();
  },

  noop() {},

  getSanitizedToken(token = '') {
    return String(token).replace(/\s+/g, '').trim();
  },

  resolveDisplayName(entityId, fallbackName) {
    const customNames = ensureObject(this.data.customNames);
    return customNames[entityId] || fallbackName || entityId;
  },

  updateDisplayNamesFromCurrentState() {
    const { mainDevice, outlets } = this.data;
    const nextMainDevice = mainDevice
      ? Object.assign({}, mainDevice, {
          name: this.resolveDisplayName(mainDevice.entityId, mainDevice.rawName || mainDevice.name),
        })
      : null;
    const nextOutlets = (outlets || []).map((item) =>
      Object.assign({}, item || {}, {
        name: this.resolveDisplayName(item.entityId, item.rawName || item.name),
      })
    );

    this.setData({
      mainDevice: nextMainDevice,
      outlets: nextOutlets,
    });
  },

  applyServerFields(partial) {
    this.setData(
      buildServerView(
        Object.assign(
          {
            serverProtocol: this.data.serverProtocol,
            serverHost: this.data.serverHost,
            serverPort: this.data.serverPort,
          },
          partial || {}
        )
      )
    );
  },

  selectServer(event) {
    const serverId = event.currentTarget.dataset.id;
    const preset = DEFAULT_SERVERS.find((item) => item.id === serverId);

    if (!preset) {
      this.setData({ selectedServerId: CUSTOM_SERVER.id });
      return;
    }

    this.applyServerFields({
      serverProtocol: preset.protocol,
      serverHost: preset.host,
      serverPort: preset.port,
    });
    this.followServerSocket();
  },

  setProtocol(event) {
    this.applyServerFields({
      serverProtocol: event.currentTarget.dataset.protocol || 'https',
    });
    this.followServerSocket();
  },

  handleHostInput(event) {
    const serverHost = event.detail.value;
    const view = buildServerView({
      serverProtocol: this.data.serverProtocol,
      serverHost,
      serverPort: this.data.serverPort,
    });

    this.data.serverHost = serverHost;
    this.setData({
      selectedServerId: view.selectedServerId,
      baseUrl: view.baseUrl,
      wsUrl: view.wsUrl,
    });
  },

  handleHostBlur(event) {
    const value = event.detail.value || this.data.serverHost;

    if (!/^https?:\/\//i.test(value) && !/:\d+\s*$/.test(value)) {
      return;
    }

    const parsed = parseServerUrl(value);
    this.applyServerFields({
      serverProtocol: parsed.protocol,
      serverHost: parsed.host,
      serverPort: parsed.port,
    });
    this.followServerSocket();
  },

  handlePortInput(event) {
    const serverPort = event.detail.value;
    const view = buildServerView({
      serverProtocol: this.data.serverProtocol,
      serverHost: this.data.serverHost,
      serverPort,
    });

    this.data.serverPort = serverPort;
    this.setData({
      selectedServerId: view.selectedServerId,
      baseUrl: view.baseUrl,
      wsUrl: view.wsUrl,
    });
  },

  toggleSettings() {
    this.setData({ settingsOpen: !this.data.settingsOpen });
  },

  handleTokenInput(event) {
    const token = event.detail.value;

    this.setData({
      token,
      tokenLength: token.length,
      cleanTokenLength: this.getSanitizedToken(token).length,
      tokenHasWhitespace: /\s/.test(token),
    });
  },

  toggleTokenVisible() {
    this.setData({ showToken: !this.data.showToken });
  },

  openRenameDialog(event) {
    const { entityId, currentName } = event.currentTarget.dataset;

    this.setData({
      renameDialogVisible: true,
      renameTargetId: entityId,
      renameInput: currentName || '',
    });
  },

  handleRenameInput(event) {
    this.setData({ renameInput: event.detail.value });
  },

  closeRenameDialog() {
    this.setData({
      renameDialogVisible: false,
      renameTargetId: '',
      renameInput: '',
    });
  },

  saveRenamedLabel() {
    const { renameTargetId, renameInput, customNames } = this.data;

    if (!renameTargetId) {
      return;
    }

    const updatedNames = Object.assign({}, ensureObject(customNames));
    const trimmedName = String(renameInput).trim();

    if (trimmedName) {
      updatedNames[renameTargetId] = trimmedName;
    } else {
      delete updatedNames[renameTargetId];
    }

    wx.setStorageSync(CUSTOM_NAME_STORAGE_KEY, updatedNames);
    this.setData({
      customNames: updatedNames,
      renameDialogVisible: false,
      renameTargetId: '',
      renameInput: '',
    });
    this.updateDisplayNamesFromCurrentState();
    wx.showToast({ title: '名称已更新', icon: 'success' });
  },

  resetRenamedLabel() {
    const { renameTargetId, customNames } = this.data;

    if (!renameTargetId) {
      return;
    }

    const updatedNames = Object.assign({}, ensureObject(customNames));
    delete updatedNames[renameTargetId];
    wx.setStorageSync(CUSTOM_NAME_STORAGE_KEY, updatedNames);

    this.setData({
      customNames: updatedNames,
      renameDialogVisible: false,
      renameTargetId: '',
      renameInput: '',
    });
    this.updateDisplayNamesFromCurrentState();
    wx.showToast({ title: '已恢复默认', icon: 'success' });
  },

  async saveConfig() {
    if (this.data.loading) {
      return;
    }

    const sanitizedToken = this.getSanitizedToken(this.data.token);
    const serverView = buildServerView({
      serverProtocol: this.data.serverProtocol,
      serverHost: this.data.serverHost,
      serverPort: this.data.serverPort,
    });

    if (!serverView.baseUrl || !sanitizedToken) {
      wx.showToast({ title: '请先填写服务器和 Token', icon: 'none' });
      return;
    }

    this.setData(
      Object.assign({}, serverView, {
        token: sanitizedToken,
        tokenLength: sanitizedToken.length,
        cleanTokenLength: sanitizedToken.length,
        tokenHasWhitespace: false,
      })
    );

    wx.setStorageSync('phicomm_dc1.baseUrl', serverView.baseUrl);
    wx.setStorageSync('phicomm_dc1.token', sanitizedToken);

    wx.showToast({ title: '配置已保存', icon: 'success' });
    await this.connectAndRefresh();
  },

  async connectAndRefresh() {
    const { baseUrl, token } = this.data;
    const sanitizedBaseUrl = baseUrl.trim();
    const sanitizedToken = this.getSanitizedToken(token);

    if (!sanitizedBaseUrl || !sanitizedToken) {
      return;
    }

    this.setData({ loading: true, errorText: '', wsConnected: false });

    try {
      const result = await fetchStates(sanitizedBaseUrl, sanitizedToken);
      this.applyState(result);
      await this.initSocket();
      if (this.data.mainDevice) {
        this.setData({ settingsOpen: false });
      }
    } catch (error) {
      await this.closeSocket();
      this.setData({
        errorText: error.message || '连接 Home Assistant 失败',
        settingsOpen: true,
        wsConnected: false,
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async refreshStates() {
    const { baseUrl, token } = this.data;
    const sanitizedBaseUrl = baseUrl.trim();
    const sanitizedToken = this.getSanitizedToken(token);

    try {
      const result = await fetchStates(sanitizedBaseUrl, sanitizedToken);
      this.applyState(result);
    } catch (error) {
      this.setData({
        errorText: error.message || '刷新状态失败',
      });
    }
  },

  applyState(result) {
    const safeResult = result || {};
    const rawMainDevice = safeResult.mainDevice;
    const mainDevice = rawMainDevice
      ? Object.assign({}, rawMainDevice, {
          rawName: rawMainDevice.name,
          name: this.resolveDisplayName(rawMainDevice.entityId, rawMainDevice.name),
        })
      : null;

    const outlets = (safeResult.outlets || []).map((item) =>
      Object.assign({}, item || {}, {
        rawName: item.name,
        name: this.resolveDisplayName(item.entityId, item.name),
      })
    );

    const decoratedMain = mainDevice
      ? Object.assign({}, mainDevice, {
          voltageText: formatMetric(mainDevice.voltage, 1),
          currentText: formatMetric(mainDevice.current, 3),
          powerText: formatMetric(mainDevice.power, 1),
          statusText: mainDevice.isOn ? '供电中' : '已关闭',
        })
      : null;

    this.setData({
      mainDevice: decoratedMain,
      outlets,
      lastUpdated: formatClock(),
      errorText: decoratedMain ? '' : '未找到 phicomm_dc1 实体，请确认 HA 中实体名称是否正确。',
    });
  },

  async toggleEntity(entityId, currentState) {
    const { baseUrl, token } = this.data;
    const sanitizedBaseUrl = baseUrl.trim();
    const sanitizedToken = this.getSanitizedToken(token);

    if (wx.vibrateShort) {
      wx.vibrateShort({ type: 'light' });
    }

    this.setData({ loading: true, errorText: '' });

    try {
      await callSwitchService({
        baseUrl: sanitizedBaseUrl,
        token: sanitizedToken,
        entityId,
        turnOn: !currentState,
      });
      await this.refreshStates();
    } catch (error) {
      this.setData({
        errorText: error.message || '控制失败',
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onToggleMain() {
    const { mainDevice } = this.data;

    if (!mainDevice) {
      return;
    }

    this.toggleEntity(mainDevice.entityId, mainDevice.isOn);
  },

  onToggleOutlet(event) {
    const { entityId, state } = event.currentTarget.dataset;
    const isOn = state === true || state === 'true';
    this.toggleEntity(entityId, isOn);
  },

  followServerSocket() {
    const token = this.getSanitizedToken(this.data.token);
    const wsUrl = this.data.wsUrl;

    if (!token || !wsUrl) {
      this.closeSocket();
      this.setData({ wsConnected: false });
      return;
    }

    if (this.activeWsUrl === wsUrl && this.data.wsConnected) {
      return;
    }

    wx.setStorageSync('phicomm_dc1.baseUrl', this.data.baseUrl);
    this.connectAndRefresh();
  },

  async initSocket() {
    const { serverProtocol, serverHost, serverPort, token, wsUrl } = this.data;
    const sanitizedToken = this.getSanitizedToken(token);
    const nextWsUrl = wsUrl || buildSocketUrl({
      protocol: serverProtocol,
      host: serverHost,
      port: serverPort,
    });

    if (!nextWsUrl || !sanitizedToken) {
      await this.closeSocket();
      this.setData({ wsConnected: false });
      return;
    }

    await this.closeSocket();

    const generation = (this.socketGeneration || 0) + 1;
    this.socketGeneration = generation;
    this.activeWsUrl = nextWsUrl;
    this.setData({ wsConnected: false, wsUrl: nextWsUrl });

    this.socketTask = connectHomeAssistantSocket({
      protocol: serverProtocol,
      host: serverHost,
      port: serverPort,
      token: sanitizedToken,
      onReady: () => {
        if (this.socketGeneration !== generation) {
          return;
        }

        this.setData({ wsConnected: true });
      },
      onEvent: (haEvent) => {
        if (this.socketGeneration !== generation) {
          return;
        }

        const entityId = haEvent && haEvent.data ? haEvent.data.entity_id || '' : '';
        if (entityId.startsWith('switch.phicomm_dc1')) {
          this.refreshStates();
        }
      },
      onError: () => {
        if (this.socketGeneration !== generation) {
          return;
        }

        this.setData({ wsConnected: false });
      },
      onClose: () => {
        if (this.socketGeneration !== generation) {
          return;
        }

        this.setData({ wsConnected: false });
      },
    });
  },

  closeSocket() {
    return new Promise((resolve) => {
      const socket = this.socketTask;
      this.socketTask = null;
      this.activeWsUrl = '';
      this.socketGeneration = (this.socketGeneration || 0) + 1;

      if (!socket) {
        resolve();
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      try {
        socket.onClose(finish);
        socket.onError(finish);
        socket.close({
          success: finish,
          fail: finish,
        });
      } catch (error) {
        finish();
      }

      setTimeout(finish, 400);
    });
  },
});
