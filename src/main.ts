import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

if (new URLSearchParams(location.search).has('showcase')) {
  import('./app/shared/ui/showcase/showcase')
    .then(({ ShowcaseComponent }) => {
      const root = document.querySelector('app-root');
      const host = document.createElement('ui-showcase');
      if (root) root.replaceWith(host);
      else document.body.appendChild(host);
      return bootstrapApplication(ShowcaseComponent, appConfig);
    })
    .catch((err) => console.error(err));
} else {
  bootstrapApplication(App, appConfig)
    .catch((err) => console.error(err));
}
