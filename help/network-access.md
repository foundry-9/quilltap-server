---
url: /settings?group=data-maintenance
---

# Reaching Quilltap from Another Machine

> **[Open this page in Quilltap](/settings?group=data-maintenance)**

Quilltap keeps one household and one key to the front door, and that key is the door itself: there is no login. Whoever can reach the port may read every letter, rearrange every drawer, open a terminal and install a plugin. The establishment therefore answers only at the tradesman's entrance of your own machine unless you instruct otherwise.

## Who Is Admitted by Default

- **Your own machine.** Started from the command line (or the desktop app), Quilltap listens on `127.0.0.1` alone. Visitors from elsewhere on the network find the door bricked up, which is precisely the point.
- **Docker.** The container listens on every interface *inside* the container; the port you publish with `-p` is the true threshold. `-p 127.0.0.1:3000:3000` keeps it to the host; plain `-p 3000:3000` opens it to the street.

## Opening the Door Wider

To admit other machines on a network you trust:

```
quilltap --host 0.0.0.0
```

or set `QUILLTAP_HOST=0.0.0.0` in the environment. In the desktop app (quilltap-shell 4.2.6 or later), tick **Open to the network** at the foot of the splash screen before pressing **Start**; leave it unticked and the house keeps to itself. Visit by IP address (`http://192.168.1.20:3000`) and you will be shown in at once.

## Calling by Name

Quilltap declines visitors who announce themselves under a name it has never been told about — a precaution against a certain kind of web page that disguises itself as your server. Loopback names (`localhost`) and plain IP addresses are always welcome. To be received under any other name, such as `nas.local` or the domain your reverse proxy answers to, list it:

```
QUILLTAP_ALLOWED_HOSTS=nas.local,quill.example.com
```

`*.example.com` admits every subdomain. The host named in `BASE_URL` is admitted without further ceremony.

## Letters from Other Sites

Requests to Quilltap's API that your browser marks as coming from some *other* web site are turned away at the door, and Quilltap offers no cross-origin permissions at all. Quilltap's own pages are unaffected.

## On the Open Internet

Do not put Quilltap on the open internet by itself. Place it behind a reverse proxy, a VPN or a single-sign-on gate that asks for credentials, and set `BASE_URL` to the public address. TLS keeps the conversation private; it does not check who is speaking.

## In-Chat Navigation

Network settings live in the environment and on the command line rather than in a settings card. The nearest room in the house is the Data & Maintenance group:

```
help_navigate(url: "/settings?group=data-maintenance")
```

## Related Topics

- [Data Directory](data-directory.md)
- [Database Protection](database-protection.md)
