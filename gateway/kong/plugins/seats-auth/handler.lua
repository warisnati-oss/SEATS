local http = require "resty.http"
local json = require "cjson.safe"
local Plugin = { PRIORITY = 1005, VERSION = "1.0.0" }

local function deny(status, message)
  return kong.response.exit(status, { error = message })
end

function Plugin:access(config)
  -- Discard every client-supplied identity, including on anonymous routes.
  kong.service.request.clear_header("x-user-id")
  kong.service.request.clear_header("x-role")
  kong.service.request.clear_header("x-seats-gateway-secret")
  local secret = os.getenv("SEATS_ADAPTER_SECRET")
  if not secret or #secret < 32 then return deny(503, "gateway authentication is not configured") end
  kong.service.request.set_header("x-seats-gateway-secret", secret)
  local path, method = kong.request.get_path(), kong.request.get_method()
  if (path == "/health" and method == "GET") or
     (path == "/api/sessions" and method == "POST") or
     (path == "/api/payments/webhook" and method == "POST") then return end

  local auth = kong.request.get_header("authorization")
  if type(auth) ~= "string" then return deny(401, "Bearer token required") end
  local token = auth:match("^[Bb][Ee][Aa][Rr][Ee][Rr]%s+([^%s]+)$")
  if not token then return deny(401, "Bearer token required") end
  local user_id, role
  if config.line_mode == "fake" then
    user_id = token:match("^fake%-line%-([%w_%-]+)$")
    if user_id then role = "customer" end
  end
  if not user_id and token:match("^[%x%-]+$") and #token == 36 then
    local client = http.new()
    client:set_timeout(3000)
    local res = client:request_uri(config.staff_session_url, {
      method = "GET", headers = { Authorization = "Bearer " .. token },
    })
    if not res or res.status >= 500 then return deny(503, "staff authentication unavailable") end
    if res.status == 200 then
      local identity = json.decode(res.body)
      if not identity or type(identity.userId) ~= "string" or
         (identity.role ~= "manager" and identity.role ~= "front_staff" and identity.role ~= "owner") then
        return deny(503, "invalid authentication response")
      end
      user_id, role = identity.userId, identity.role
    end
  elseif not user_id and config.line_mode == "line" then
    if config.line_channel_id == "" then return deny(503, "LINE channel ID is not configured") end
    local client = http.new()
    client:set_timeout(5000)
    local res = client:request_uri("https://api.line.me/oauth2/v2.1/verify", {
      method = "POST", ssl_verify = true,
      headers = { ["Content-Type"] = "application/x-www-form-urlencoded" },
      body = ngx.encode_args({ id_token = token, client_id = config.line_channel_id }),
    })
    if not res or res.status >= 500 then return deny(503, "LINE authentication unavailable") end
    if res.status == 200 then
      local claims = json.decode(res.body)
      if claims and type(claims.sub) == "string" and claims.sub ~= "" and
         claims.iss == "https://access.line.me" and tostring(claims.aud) == config.line_channel_id and
         type(claims.exp) == "number" and claims.exp > ngx.time() then
        user_id, role = claims.sub, "customer"
      end
    end
  end
  if not user_id then return deny(401, "invalid or expired token") end
  kong.service.request.set_header("x-user-id", user_id)
  kong.service.request.set_header("x-role", role)
end
return Plugin
