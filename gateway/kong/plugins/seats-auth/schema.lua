local typedefs = require "kong.db.schema.typedefs"
return {
  name = "seats-auth",
  fields = {
    { consumer = typedefs.no_consumer },
    { protocols = typedefs.protocols_http },
    { config = { type = "record", fields = {
      { staff_session_url = { type = "string", required = true } },
      { line_mode = { type = "string", default = "line", one_of = { "line", "fake" } } },
      { line_channel_id = { type = "string", default = "", len_min = 0 } },
    } } },
  },
}
