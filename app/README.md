# devpush

Deploy Docker Compose applications to your own servers with a git push. Run the dashboard on Cloudflare Workers or Node; the Linux agent builds and runs your applications.

<a href="https://devpu.sh/videos/devpush-demo.mp4" target="_blank" rel="noopener noreferrer">
  <img src="https://devpu.sh/videos/readme-demo.png" alt="Watch the devpush demo" width="1200" />
</a>

Includes environments, custom domains and HTTPS, encrypted variables, logs, server monitoring, backups, teams, a REST API and MCP.

## Get started

[Use the hosted dashboard](https://app.devpu.sh) or [self-host devpush](https://devpu.sh/docs/self-hosting/).

To use this package in your own project:

```sh
pnpm add --save-exact devpush
```

Follow [Package integration](https://devpu.sh/docs/package-installation/) to configure your dashboard, databases and authentication, then build and deploy. Installing the package alone does not start a dashboard.

[Documentation](https://devpu.sh/docs/) · [Source and contributing](https://github.com/hunvreus/devpush) · [MIT license](https://github.com/hunvreus/devpush/blob/main/LICENSE.md)
