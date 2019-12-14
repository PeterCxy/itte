addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const REGEX_EMAIL = /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/

function makeid(length) {
  var result           = '';
  var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;
  for ( var i = 0; i < length; i++ ) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

async function handleRequest(request) {
  let url = new URL(request.url)

  for (key of Object.keys(HANDLERS)){
    if (url.pathname.startsWith(key) && HANDLERS[key][request.method] != null) {
      try {
        return await HANDLERS[key][request.method](request, url)
      } catch (err) {
        return buildErrorResponse(err)
      }
    }
  }

  return new Response(null, {
    status: 404
  })
}

function buildErrorResponse(err) {
  return new Response(err, {
    status: 400
  })
}

async function postComment(request, url) {
  var data

  try {
    data = await request.json()
  } catch (err) {
    return buildErrorResponse("Invalid JSON object")
  }

  try {
    validateCommentObject(data)
  } catch (err) {
    return new Response(err, {
      status: 400
    })
  }

  data.created_at = Date.now()
  data.content = sanitizeHTML(data.content)
  data.id = makeid(5)

  // Complement the actual key in store
  // When lexicographically ordered, this will be in reversed-time order
  // which is what we want
  let dateKey = Number.MAX_SAFE_INTEGER - data.created_at

  let key = `comment:${data.path}:${dateKey}:${data.id}`

  await KV.put(key, JSON.stringify(data))

  delete data.secret

  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json"
    }
  })
}

function validateCommentObject(obj) {
  if (typeof obj.path != "string" || obj.path.length >= 255) {
    throw "No Valid Path Provided"
  }

  if (typeof obj.secret != "string" || obj.secret.length >= 255) {
    throw "No Valid Secret Provided"
  }

  if (typeof obj.content != "string" || obj.content.length >= 1024) {
    throw "No Valid Content Provided"
  }

  if (typeof obj.username != "string" || obj.username.length >= 32) {
    throw "No Valid User Name Provided"
  }

  if (typeof obj.email != "string" || obj.email.length >= 255) {
    throw "No E-mail Provided"
  }

  if (!REGEX_EMAIL.test(obj.email)) {
    throw "Malformed E-mail"
  }
}

function sanitizeHTML(str) {
  return str.replace("<", "&lt;")
    .replace(">", "&gt;")
}

async function listComments(request, url) {
  if (!url.searchParams.has("path")) {
    return buildErrorResponse("What Path do you want?")
  }

  let path = url.searchParams.get("path")
  let limit = 5
  let cursor = null

  if (url.searchParams.has("limit")) {
    try {
      limit = Number.parseInt(url.searchParams.get("limit"))
    } catch (err) {
      return buildErrorResponse("Invalid number")
    }
  }

  if (url.searchParams.has("cursor")) {
    cursor = url.searchParams.get("cursor")
  }

  let list = await KV.list({
    prefix: `comment:${path}:`,
    limit: limit,
    cursor: cursor
  })
  let res = {
    ok: true,
    list: []
  }

  for (key of list.keys) {
    let obj = JSON.parse(await KV.get(key.name))
    delete obj.secret
    res.list.push(obj)
  }

  if (!list.list_complete) {
    res.cursor = list.cursor
  }

  return new Response(JSON.stringify(res), {
    headers: {
      "content-type": "application/json"
    }
  })
}

async function editComment(request, url) {
  var data

  try {
    data = await request.json()
  } catch (err) {
    return buildErrorResponse("Invalid JSON object")
  }

  if (!(data.path && data.created_at && data.content && data.secret && data.id
      && typeof data.path == "string"
      && typeof data.created_at == "number"
      && typeof data.content == "string"
      && typeof data.secret == "string"
      && typeof data.id == "string"
      && data.content.length < 1024)) {
    return buildErrorResponse("You must specify `path`, `id`, `created_at`, `secret` and new `content`")
  }

  let dateKey = Number.MAX_SAFE_INTEGER - data.created_at

  let key = `comment:${data.path}:${dateKey}:${data.id}`

  let origData = await KV.get(key)
  if (!origData) {
    return buildErrorResponse("Original Comment Not Found")
  }

  origData = JSON.parse(origData)
  if (origData.secret != data.secret) {
    return buildErrorResponse("Wrong Secret")
  }

  origData.content = data.content
  await KV.put(key, JSON.stringify(origData))

  delete origData.secret

  return new Response(JSON.stringify(origData), {
    headers: {
      "content-type": "application/json"
    }
  })
}

const HANDLERS = {
  "/comments": {
    "PUT": postComment,
    "GET": listComments,
    "PATCH": editComment
  }
}