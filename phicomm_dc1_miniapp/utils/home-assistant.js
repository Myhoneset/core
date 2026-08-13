const DEFAULT_ENTITY_IDS = [
  'switch.phicomm_dc1',
  'switch.phicomm_dc1_p1',
  'switch.phicomm_dc1_p2',
  'switch.phicomm_dc1_p3',
];

const DEFAULT_SERVERS = [
  {
    id: 'ynggv',
    name: '测试服 A',
    hint: 'seo.ynggv.com:8123',
    host: 'seo.ynggv.com',
    port: '8123',
    protocol: 'https',
  },
  {
    id: 'amoyu',
    name: '测试服 B',
    hint: 'seo.amoyu.top:8123',
    host: 'seo.amoyu.top',
    port: '8123',
    protocol: 'https',
  },
];

const CUSTOM_SERVER = {
  id: 'custom',
  name: '自定义',
  hint: '手动填写地址和端口',
  host: '',
  port: '8123',
  protocol: 'https',
};

function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl).trim().replace(/\/$/, '');
}

function parseServerUrl(rawUrl = '') {
  const trimmed = normalizeBaseUrl(rawUrl);

  if (!trimmed) {
    return {
      protocol: 'https',
      host: '',
      port: '8123',
    };
  }

  let protocol = 'https';
  let rest = trimmed;
  const protocolMatch = trimmed.match(/^(https?):\/\//i);

  if (protocolMatch) {
    protocol = protocolMatch[1].toLowerCase();
    rest = trimmed.slice(protocolMatch[0].length);
  }

  const hostAndPort = rest.split('/')[0];
  const portMatch = hostAndPort.match(/^(.+):(\d+)$/);

  if (portMatch) {
    return {
      protocol,
      host: portMatch[1],
      port: portMatch[2],
    };
  }

  return {
    protocol,
    host: hostAndPort,
    port: '8123',
  };
}

function cleanHostName(host = '') {
  return String(host || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
}

function buildServerUrl({ protocol = 'https', host = '', port = '8123' } = {}) {
  const cleanHost = cleanHostName(host);
  const cleanPort = String(port || '').trim();

  if (!cleanHost) {
    return '';
  }

  const normalizedProtocol = String(protocol || 'https').replace(/:$/, '').toLowerCase();

  if (cleanPort) {
    return `${normalizedProtocol}://${cleanHost}:${cleanPort}`;
  }

  return `${normalizedProtocol}://${cleanHost}`;
}

function buildSocketUrl({ protocol = 'https', host = '', port = '8123' } = {}) {
  const cleanHost = cleanHostName(host);
  const cleanPort = String(port || '').trim() || '8123';

  if (!cleanHost) {
    return '';
  }

  const httpProtocol = String(protocol || 'https').replace(/:$/, '').toLowerCase();
  const wsProtocol = httpProtocol === 'http' ? 'ws' : 'wss';

  return `${wsProtocol}://${cleanHost}:${cleanPort}/api/websocket`;
}

function matchServerPreset({ protocol, host, port } = {}) {
  const normalizedHost = String(host || '').trim();
  const normalizedPort = String(port || '').trim();
  const normalizedProtocol = String(protocol || 'https').toLowerCase();

  return (
    DEFAULT_SERVERS.find(
      (item) =>
        item.host === normalizedHost &&
        item.port === normalizedPort &&
        item.protocol === normalizedProtocol
    ) || CUSTOM_SERVER
  );
}

function formatMetric(value, digits = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '--';
}

function normalizeToken(token = '') {
  return String(token).replace(/\s+/g, '').trim();
}

function buildHeaders(token) {
  const normalizedToken = normalizeToken(token);

  return {
    Authorization: `Bearer ${normalizedToken}`,
    'Content-Type': 'application/json',
  };
}

function request({ baseUrl, token, path, method = 'GET', data }) {
  const fixedBaseUrl = normalizeBaseUrl(baseUrl);

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${fixedBaseUrl}${path}`,
      method,
      data,
      header: buildHeaders(token),
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }

        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error('Token 验证失败，请检查是否完整复制，或是否包含空格与换行。'));
          return;
        }

        reject(new Error(`接口请求失败，状态码：${res.statusCode}`));
      },
      fail: (error) => reject(error),
    });
  });
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickFriendlyName(entity) {
  const safeEntity = entity || {};
  const attributes = safeEntity.attributes || {};

  if (attributes.friendly_name) {
    return attributes.friendly_name;
  }
  return safeEntity.entity_id || 'unknown';
}

function parseDeviceStates(states = []) {
  const safeStates = Array.isArray(states) ? states : [];
  const dc1States = safeStates.filter((item) => item && DEFAULT_ENTITY_IDS.includes(item.entity_id));

  const main = dc1States.find((item) => item.entity_id === 'switch.phicomm_dc1') || null;

  const outlets = dc1States
    .filter((item) => item.entity_id !== 'switch.phicomm_dc1')
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
    .map((item) => ({
      entityId: item.entity_id,
      name: pickFriendlyName(item),
      isOn: item.state === 'on',
    }));

  return {
    mainDevice: main
      ? (() => {
          const attributes = main.attributes || {};

          return {
            entityId: main.entity_id,
            name: pickFriendlyName(main),
            isOn: main.state === 'on',
            voltage: toNumber(attributes.voltage_v),
            current: toNumber(attributes.current_a),
            power: toNumber(attributes.power_w),
            deviceIp: attributes.device_ip || '-',
            serverIp: attributes.server_ip || '-',
            connected: Boolean(attributes.connected),
            listening: Boolean(attributes.listening),
          };
        })()
      : null,
    outlets,
  };
}

async function fetchStates(baseUrl, token) {
  const states = await request({
    baseUrl,
    token,
    path: '/api/states',
  });

  return parseDeviceStates(states || []);
}

async function callSwitchService({ baseUrl, token, entityId, turnOn }) {
  return request({
    baseUrl,
    token,
    path: `/api/services/switch/${turnOn ? 'turn_on' : 'turn_off'}`,
    method: 'POST',
    data: { entity_id: entityId },
  });
}

function connectHomeAssistantSocket({
  baseUrl,
  protocol,
  host,
  port,
  token,
  onReady,
  onEvent,
  onError,
  onClose,
}) {
  const wsUrl =
    host || protocol
      ? buildSocketUrl({ protocol, host, port })
      : buildSocketUrl(parseServerUrl(baseUrl));
  const normalizedToken = normalizeToken(token);
  const socketTask = wx.connectSocket({ url: wsUrl });
  let nextId = 1;

  socketTask.onMessage((message) => {
    try {
      const payload = JSON.parse(message.data);

      if (payload.type === 'auth_required') {
        socketTask.send({ data: JSON.stringify({ type: 'auth', access_token: normalizedToken }) });
        return;
      }

      if (payload.type === 'auth_invalid') {
        onError && onError(new Error('WebSocket 鉴权失败，请重新检查 Token。'));
        return;
      }

      if (payload.type === 'auth_ok') {
        socketTask.send({
          data: JSON.stringify({
            id: nextId++,
            type: 'subscribe_events',
            event_type: 'state_changed',
          }),
        });
        onReady && onReady();
        return;
      }

      if (payload.type === 'event') {
        onEvent && onEvent(payload.event);
      }
    } catch (error) {
      onError && onError(error);
    }
  });

  socketTask.onError((error) => {
    onError && onError(error);
  });

  socketTask.onClose(() => {
    onClose && onClose();
  });

  return socketTask;
}

module.exports = {
  DEFAULT_ENTITY_IDS,
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
};
