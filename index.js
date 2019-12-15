const CORS_ALLOW_ORIGIN = [
  "https://itte.takanashi.workers.dev",
  "https://demo.typeblog.net"
]

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

function buildErrorResponse(request, err) {
  return new Response(err, {
    status: 400,
    headers: addCORSHeaders(request, {})
  })
}

function addCORSHeaders(request, headers) {
  if (!request.headers.has("origin")) {
    return headers
  }

  let origin = request.headers.get("origin")

  for (o of CORS_ALLOW_ORIGIN) {
    if (origin == o) {
      headers["Access-Control-Allow-Origin"] = o
      headers["Vary"] = "Origin"
    }
  }

  return headers
}

async function handleCORSHeaders(request) {
  if (!request.headers.has("origin")) {
    return new Response(null, {
      status: 403
    })
  }

  return new Response(null, {
    status: 200,
    headers: addCORSHeaders(request, {})
  })
}

async function postComment(request, url) {
  var data

  try {
    data = await request.json()
  } catch (err) {
    return buildErrorResponse(request, "Invalid JSON object")
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
    headers: addCORSHeaders(request, {
      "content-type": "application/json"
    })
  })
}

function validateCommentObject(obj) {
  if (typeof obj.path != "string" || obj.path.length >= 255) {
    throw "No Valid Path Provided"
  }

  try {
    new URL(obj.path)
  } catch (err) {
    throw "Invalid URL"
  }

  if (typeof obj.secret != "string" || obj.secret.length >= 255) {
    throw "No Valid Secret Provided"
  }

  if (typeof obj.content != "string" || obj.content.length < 3 || obj.content.length >= 1024) {
    throw "No Valid Content Provided"
  }

  if (typeof obj.username != "string" || obj.username.length < 1 || obj.username.length >= 32) {
    throw "No Valid User Name Provided"
  }

  if (typeof obj.email != "string" || obj.email.length < 1 || obj.email.length >= 255) {
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
    return buildErrorResponse(request, "What Path do you want?")
  }

  let path = url.searchParams.get("path")
  let limit = 5
  let cursor = null

  if (url.searchParams.has("limit")) {
    try {
      limit = Number.parseInt(url.searchParams.get("limit"))
    } catch (err) {
      return buildErrorResponse(request, "Invalid number")
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
    headers: addCORSHeaders(request, {
      "content-type": "application/json"
    })
  })
}

async function editComment(request, url) {
  var data

  try {
    data = await request.json()
  } catch (err) {
    return buildErrorResponse(request, "Invalid JSON object")
  }

  if (!(data.path && data.created_at && data.content && data.secret && data.id
      && typeof data.path == "string"
      && typeof data.created_at == "number"
      && typeof data.content == "string"
      && typeof data.secret == "string"
      && typeof data.id == "string"
      && data.content.length < 1024)) {
    return buildErrorResponse(request, "You must specify `path`, `id`, `created_at`, `secret` and new `content`")
  }

  let dateKey = Number.MAX_SAFE_INTEGER - data.created_at

  let key = `comment:${data.path}:${dateKey}:${data.id}`

  let origData = await KV.get(key)
  if (!origData) {
    return buildErrorResponse(request, "Original Comment Not Found")
  }

  origData = JSON.parse(origData)
  if (origData.secret != data.secret) {
    return buildErrorResponse(request, "Wrong Secret")
  }

  origData.content = data.content
  await KV.put(key, JSON.stringify(origData))

  delete origData.secret

  return new Response(JSON.stringify(origData), {
    headers: addCORSHeaders(request, {
      "content-type": "application/json"
    })
  })
}

const HANDLERS = {
  "/comments": {
    "OPTIONS": handleCORSHeaders,
    "PUT": postComment,
    "GET": listComments,
    "PATCH": editComment
  },
  "/itte.js": {
    "GET": async function() {
      return new Response(`${makeid.toString()}\n${frontend.toString()}\nfrontend()`, {
        headers: {
          "content-type": "application/javascript"
        }
      })
    }
  },
  "/itte.css": {
    "GET": async function() {
      return new Response(FRONTEND_CSS, {
        headers: {
          "content-type": "text/css"
        }
      })
    }
  },
  "/demo": {
    "GET": async function() {
      return new Response(DEMO_HTML, {
        headers: {
          "content-type": "text/html"
        }
      })
    }
  }
}
const DEMO_HTML = `
<head>
  <title>Itte Demo Site</title>
  <script src="/itte.js"></script>
  <style>
    .content {
      width: 60%;
      margin-left: 20%;
    }
  </style>
</head>
<body>
  <div class="content">
    <h1>Itte Demo Site</h1>
    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
    <section id="itte-thread" data-path="https://typeblog.net/test">
  </div>
</body>
`

// === FRONTEND CODE ===
function frontend() {
  const COMMENT_PLACEHOLDER = "Type Comment Here (at least 3 chars)"
  const BASE_URL = document.currentScript.src.replace("/itte.js", "")
  // Insert the style element first
  let styleLink = document.createElement('link')
  styleLink.rel = "stylesheet"
  styleLink.type = "text/css"
  styleLink.href = `${BASE_URL}/itte.css`
  document.getElementsByTagName("head")[0].appendChild(styleLink)

  var commentElement = null
  var commentPath = null
  var commentListElement = null
  var currentCursor = null
  var commentList = []
  var postedCommentCount = 0
  var loadMoreElement = null
  function contentLoaded() {
    if (localStorage.getItem("secret") == null) {
      // Make sure we have generated a secret here
      localStorage.setItem("secret", makeid(20))
    }

    commentElement = document.getElementById("itte-thread")
    if (commentElement == null) {
      // It's not possible to load anything on this page
      return;
    }

    commentPath = commentElement.getAttribute("data-path")
    if (commentPath == null) {
      return;
    }

    buildCommentForm()
    fetchComments()
  }

  function buildCommentForm() {
    commentElement.innerHTML = `
      <div class="itte-postbox">
        <div class="form-wrapper">
          <div class="textarea-wrapper">
            <div class="textarea placeholder" contenteditable="true">${COMMENT_PLACEHOLDER}</div>
          </div>
          <section class="auth-section">
            <p class="input-wrapper">
              <input type="text" name="author" placeholder="Name" value="">
            </p>
            <p class="input-wrapper">
              <input type="email" name="email" placeholder="E-mail" value="">
            </p>
            <p class="post-action">
              <input type="submit" value="Submit">
            </p>
          </section>
        </div>
      </div>
      <div id="itte-root">
      </div>
      <div class="text-wrapper">
        <a href="#" id="itte-load-more" style="visibility: hidden">Load more...</a>
      </div>
    `

    commentListElement = document.getElementById("itte-root")
    loadMoreElement = document.getElementById("itte-load-more")
    
    initializeEditor()

    loadMoreElement.addEventListener("click", (ev) => {
      ev.preventDefault()
      fetchComments()
    })
  }

  function initializeEditor() {
    let editor = commentElement.getElementsByClassName("textarea")[0]
    editor.addEventListener("focus", () => {
      if (editor.classList.contains("placeholder")) {
        editor.classList.remove("placeholder")
        editor.textContent = ""
      }
    })

    editor.addEventListener("blur", () => {
      if (editor.textContent.length == 0) {
        editor.textContent = COMMENT_PLACEHOLDER
        editor.classList.add("placeholder")
      }
    })

    let author = commentElement.querySelector('input[name="author"]')
    let email = commentElement.querySelector('input[name="email"]')
    let submit = commentElement.querySelector('input[type="submit"]')

    if (localStorage.getItem("author") != null) {
      author.value = localStorage.getItem("author")
    }

    if (localStorage.getItem("email") != null) {
      email.value = localStorage.getItem("email")
    }

    submit.addEventListener("click", () => {
      if (!email.checkValidity()) return

      let obj = {
        secret: localStorage.getItem("secret"),
        content: editor.textContent,
        username: author.value,
        email: email.value,
        path: commentPath
      }

      if (obj.content == COMMENT_PLACEHOLDER || obj.content.length < 3 || obj.username.length < 1 || obj.email.length < 1) {
        return
      }

      submit.disabled = true
      fetch(`${BASE_URL}/comments`, {
        method: 'PUT',
        body: JSON.stringify(obj),
        headers: {
          "content-type": "application/json"
        }
      }).then((resp) => resp.json())
        .then((obj) => {
          postedCommentCount++
          commentList.splice(0, 0, obj)
          let elem = createCommentElement(obj, -postedCommentCount)
          if (!commentListElement.hasChildNodes()) {
            commentListElement.appendChild(elem)
          } else {
            commentListElement.insertBefore(elem, commentListElement.childNodes[0])
          }
          localStorage.setItem(obj.id, "true")
          localStorage.setItem("author", obj.username)
          localStorage.setItem("email", obj.email)
          submit.disabled = false
          editor.textContent = COMMENT_PLACEHOLDER
          editor.classList.add("placeholder")
        })
        .catch((err) => {
          submit.disabled = false
          console.log(err)
        })
    })
  }

  function fetchComments() {
    loadMoreElement.style["visibility"] = "hidden"
    let url = `${BASE_URL}/comments?path=${encodeURIComponent(commentPath)}`
    if (currentCursor != null) {
      url += `&cursor=${currentCursor}`
    }
    fetch(url)
      .then((resp) => resp.json())
      .then((obj) => {
        console.log(obj)
        for (comm of obj.list) {
          commentList.push(comm)
          let index = commentList.length - 1
          let elem = createCommentElement(comm, index)
          commentListElement.appendChild(elem)
        }

        currentCursor = obj.cursor

        if (currentCursor) {
          loadMoreElement.style["visibility"] = "visible"
        }
      })
      .catch((err) => {
        console.log(err)
        // TODO: Show a load button?
      })
  }

  function createCommentElement(comm, index) {
    let created_at = new Date(comm.created_at)
    let elem = document.createElement("div")
    elem.setAttribute("id", `itte-${index}`)
    elem.classList.add("itte-comment")
    elem.classList.add("itte-no-votes")
    elem.innerHTML = `
      <div class="avatar"></div>
      <div class="text-wrapper">
        <div class="itte-comment-header" role="meta">
          <span class="author">${comm.username}</span>
          <span class="spacer">&sol;</span>
          <a class="permalink" href="#itte-${index}">
            <time title="${created_at.toLocaleString()}" datetime="${created_at.toString()}">
              ${timeSince(created_at)}
            </time>
          </a>
        </div>
        <div class="text">
          ${comm.content}
        </div>
        <div class="itte-comment-footer">
        </div>
      </div>
    `
    elem.getElementsByClassName("avatar")[0]
      .appendChild(generateIdenticon(comm.content.hashCode(), 4, 48))
    return elem
  }

  document.addEventListener("DOMContentLoaded", contentLoaded)

  function timeSince(date) {
    var seconds = Math.floor((new Date() - date) / 1000);
  
    var interval = Math.floor(seconds / 31536000);
  
    if (interval > 1) {
      return interval + " years";
    }
    interval = Math.floor(seconds / 2592000);
    if (interval > 1) {
      return interval + " months";
    }
    interval = Math.floor(seconds / 86400);
    if (interval > 1) {
      return interval + " days";
    }
    interval = Math.floor(seconds / 3600);
    if (interval > 1) {
      return interval + " hours";
    }
    interval = Math.floor(seconds / 60);
    if (interval > 1) {
      return interval + " minutes";
    }
    return Math.floor(seconds) + " seconds";
  }

  // <https://gist.github.com/iperelivskiy/4110988>
  // This do not need to be secure in any sense
  String.prototype.hashCode = function () {
    /* Simple hash function. */
    var a = 1, c = 0, h, o;
    if (this) {
      a = 0;
      /*jshint plusplus:false bitwise:false*/
      for (h = this.length - 1; h >= 0; h--) {
        o = this.charCodeAt(h);
        a = (a << 6 & 268435455) + o + (o << 14);
        c = a & 266338304;
        a = c !== 0 ? a ^ c >> 21 : a;
      }
    }
    return String(a);
  }

  // <https://github.com/posativ/isso/blob/master/isso/js/app/lib/identicons.js>
  function pad(n, width) {
    return n.length >= width ? n : new Array(width - n.length + 1).join("0") + n;
  };

  /**
   * Fill in a square on the canvas.
   */
  function fill(svg, x, y, padding, size, color) {
    var rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");

    rect.setAttribute("x", padding + x * size);
    rect.setAttribute("y", padding + y * size);
    rect.setAttribute("width", size);
    rect.setAttribute("height", size);
    rect.setAttribute("style", "fill: " + color);

    svg.appendChild(rect);
  };

  const AVATAR_FG = [
    "#9abf88", "#5698c4", "#e279a3", "#9163b6",
    "#be5168", "#f19670", "#e4bf80", "#447c69"
  ]

  const AVATAR_BG = "#f0f0f0"
  
  const GRID = 5

  function generateIdenticon(key, padding, size) {

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("version", "1.1");
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    svg.setAttribute("shape-rendering", "crispEdges");
    fill(svg, 0, 0, 0, size + 2 * padding, AVATAR_BG);

    if (typeof key === null) {
      return svg;
    }

    var hash = pad((parseInt(key.substr(-16), 16) % Math.pow(2, 18)).toString(2), 18),
      index = 0;

    svg.setAttribute("data-hash", key);

    var i = parseInt(hash.substring(hash.length - 3, hash.length), 2),
      color = AVATAR_FG[i % AVATAR_FG.length];

    for (var x = 0; x < Math.ceil(GRID / 2); x++) {
      for (var y = 0; y < GRID; y++) {

        if (hash.charAt(index) === "1") {
          fill(svg, x, y, padding, 8, color);

          // fill right sight symmetrically
          if (x < Math.floor(GRID / 2)) {
            fill(svg, (GRID - 1) - x, y, padding, 8, color);
          }
        }
        index++;
      }
    }

    return svg;
  }
}

// Copycat from ISSO, thanks a lot :)
const FRONTEND_CSS = `
#itte-thread * {
  -webkit-box-sizing: border-box;
  -moz-box-sizing: border-box;
  box-sizing: border-box;
}
#itte-thread .itte-comment-header a {
  text-decoration: none;
}

#itte-thread {
  padding: 0;
  margin: 0;
}
#itte-thread > h4 {
  color: #555;
  font-weight: bold;
}
#itte-thread > .itte-feedlink {
  float: right;
  padding-left: 1em;
}
#itte-thread > .itte-feedlink > a {
  font-size: 0.8em;
  vertical-align: bottom;
}
#itte-thread .textarea {
  min-height: 58px;
  outline: 0;
}
#itte-thread .textarea.placeholder {
  color: #757575;
}

#itte-root .itte-comment {
  max-width: 68em;
  padding-top: 0.95em;
  margin: 0.95em auto;
}
#itte-root .preview .itte-comment {
  padding-top: 0;
  margin: 0;
}
#itte-root .itte-comment:not(:first-of-type),
.itte-follow-up .itte-comment {
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}
.itte-comment > div.avatar {
  display: block;
  float: left;
  width: 7%;
  margin: 3px 15px 0 0;
}
.itte-comment > div.avatar > svg {
  max-width: 48px;
  max-height: 48px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 3px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.itte-comment > div.text-wrapper {
  display: block;
}
.itte-comment .itte-follow-up {
  padding-left: calc(7% + 20px);
}
.itte-comment > div.text-wrapper > .itte-comment-header, .itte-comment > div.text-wrapper > .itte-comment-footer {
  font-size: 0.95em;
}
.itte-comment > div.text-wrapper > .itte-comment-header {
  font-size: 0.85em;
}
.itte-comment > div.text-wrapper > .itte-comment-header .spacer {
  padding: 0 6px;
}
.itte-comment > div.text-wrapper > .itte-comment-header .spacer,
.itte-comment > div.text-wrapper > .itte-comment-header a.permalink,
.itte-comment > div.text-wrapper > .itte-comment-header .note,
.itte-comment > div.text-wrapper > .itte-comment-header a.parent {
  color: gray !important;
  font-weight: normal;
  text-shadow: none !important;
}
.itte-comment > div.text-wrapper > .itte-comment-header .spacer:hover,
.itte-comment > div.text-wrapper > .itte-comment-header a.permalink:hover,
.itte-comment > div.text-wrapper > .itte-comment-header .note:hover,
.itte-comment > div.text-wrapper > .itte-comment-header a.parent:hover {
  color: #606060 !important;
}
.itte-comment > div.text-wrapper > .itte-comment-header .note {
  float: right;
}
.itte-comment > div.text-wrapper > .itte-comment-header .author {
  font-weight: bold;
  color: #555;
}
.itte-comment > div.text-wrapper > .textarea-wrapper .textarea,
.itte-comment > div.text-wrapper > .textarea-wrapper .preview {
  margin-top: 0.2em;
}
.itte-comment > div.text-wrapper > div.text p {
  margin-top: 0.2em;
}
.itte-comment > div.text-wrapper > div.text p:last-child {
  margin-bottom: 0.2em;
}
.itte-comment > div.text-wrapper > div.text h1,
.itte-comment > div.text-wrapper > div.text h2,
.itte-comment > div.text-wrapper > div.text h3,
.itte-comment > div.text-wrapper > div.text h4,
.itte-comment > div.text-wrapper > div.text h5,
.itte-comment > div.text-wrapper > div.text h6 {
  font-size: 130%;
  font-weight: bold;
}
.itte-comment > div.text-wrapper > div.textarea-wrapper .textarea,
.itte-comment > div.text-wrapper > div.textarea-wrapper .preview {
  width: 100%;
  border: 1px solid #f0f0f0;
  border-radius: 2px;
  box-shadow: 0 0 2px #888;
}
.itte-comment > div.text-wrapper > .itte-comment-footer {
  font-size: 0.80em;
  color: gray !important;
  clear: left;
}
.itte-feedlink,
#itte-load-more,
.itte-comment > div.text-wrapper > .itte-comment-footer a {
  font-weight: bold;
  text-decoration: none;
}
.itte-feedlink:hover,
#itte-load-more:hover,
.itte-comment > div.text-wrapper > .itte-comment-footer a:hover {
  color: #111111 !important;
  text-shadow: #aaaaaa 0 0 1px !important;
}
.itte-comment > div.text-wrapper > .itte-comment-footer > a {
  position: relative;
  top: .2em;
}
.itte-comment > div.text-wrapper > .itte-comment-footer > a + a {
  padding-left: 1em;
}
.itte-comment > div.text-wrapper > .itte-comment-footer .votes {
  color: gray;
}
.itte-comment > div.text-wrapper > .itte-comment-footer .upvote svg,
.itte-comment > div.text-wrapper > .itte-comment-footer .downvote svg {
  position: relative;
  top: .2em;
}
.itte-comment .itte-postbox {
  margin-top: 0.8em;
}
.itte-comment.itte-no-votes span.votes {
  display: none;
}

.itte-postbox {
  max-width: 68em;
  margin: 0 auto 2em;
  clear: right;
}
.itte-postbox > .form-wrapper {
  display: block;
  padding: 0;
}
.itte-postbox > .form-wrapper > .auth-section,
.itte-postbox > .form-wrapper > .auth-section .post-action {
  display: block;
}
.itte-postbox > .form-wrapper .textarea,
.itte-postbox > .form-wrapper .preview {
  margin: 0 0 .3em;
  padding: .4em .8em;
  border-radius: 3px;
  background-color: #fff;
  border: 1px solid rgba(0, 0, 0, 0.2);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.itte-postbox > .form-wrapper input[type=checkbox] {
  vertical-align: middle;
  position: relative;
  bottom: 1px;
  margin-left: 0;
}
.itte-postbox > .form-wrapper .notification-section {
  font-size: 0.90em;
  padding-top: .3em;
}
#itte-thread .textarea:focus,
#itte-thread input:focus {
  border-color: rgba(0, 0, 0, 0.8);
}
.itte-postbox > .form-wrapper > .auth-section .input-wrapper {
  display: inline-block;
  position: relative;
  max-width: 25%;
  margin: 0;
}
.itte-postbox > .form-wrapper > .auth-section .input-wrapper input {
  padding: .3em 10px;
  max-width: 100%;
  border-radius: 3px;
  background-color: #fff;
  line-height: 1.4em;
  border: 1px solid rgba(0, 0, 0, 0.2);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.itte-postbox > .form-wrapper > .auth-section .post-action {
  display: inline-block;
  float: right;
  margin: 0 0 0 5px;
}
.itte-postbox > .form-wrapper > .auth-section .post-action > input {
  padding: calc(.3em - 1px);
  border-radius: 2px;
  border: 1px solid #CCC;
  background-color: #DDD;
  cursor: pointer;
  outline: 0;
  line-height: 1.4em;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.itte-postbox > .form-wrapper > .auth-section .post-action > input:hover {
  background-color: #CCC;
}
.itte-postbox > .form-wrapper > .auth-section .post-action > input:active {
  background-color: #BBB;
}
.itte-postbox > .form-wrapper .preview,
.itte-postbox > .form-wrapper input[name="edit"],
.itte-postbox.preview-mode > .form-wrapper input[name="preview"],
.itte-postbox.preview-mode > .form-wrapper .textarea {
  display: none;
}
.itte-postbox.preview-mode > .form-wrapper .preview {
  display: block;
}
.itte-postbox.preview-mode > .form-wrapper input[name="edit"] {
  display: inline;
}
.itte-postbox > .form-wrapper .preview {
  background-color: #f8f8f8;
  background: repeating-linear-gradient(
      -45deg,
      #f8f8f8,
      #f8f8f8 10px,
      #fff 10px,
      #fff 20px
  );
}
.itte-postbox > .form-wrapper > .notification-section {
  display: none;
  padding-bottom: 10px;
}
@media screen and (max-width:600px) {
  .itte-postbox > .form-wrapper > .auth-section .input-wrapper {
      display: block;
      max-width: 100%;
      margin: 0 0 .3em;
  }
  .itte-postbox > .form-wrapper > .auth-section .input-wrapper input {
      width: 100%;
  }
}
`