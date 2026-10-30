import type { Language } from '../../shared/settings/settings.model';

/** Spanish is the source of the keys: `en` must have exactly the same ones or it does not compile. */
export const es = {
  'window.minimize': 'Minimizar',
  'window.maximize': 'Maximizar',
  'window.restore': 'Restaurar',
  'window.close': 'Cerrar',
  'workspace.comingSoon': 'Próximamente',
  'workspace.comingSoonDetail': 'Esta pantalla llegará en una próxima versión.',
  'rail.label': 'Principal',
  'rail.chat': 'Chat',
  'rail.projects': 'Proyectos',
  'rail.history': 'Historial',
  'rail.settings': 'Ajustes',
  'projects.title': 'Proyectos',
  'projects.collapse': 'Colapsar proyectos',
  'projects.expand': 'Expandir proyectos',
  'projects.placeholder': 'La lista de proyectos llegará pronto.',
  'projects.content': 'Contenido del proyecto',
  'projects.contentPlaceholder': 'Las sesiones, terminales y archivos del proyecto llegarán pronto.',
  'projects.showContent': 'Mostrar el contenido del proyecto',
  'projects.hideContent': 'Ocultar el contenido del proyecto',
  'projects.chatPlaceholder': 'Aquí se abrirá la sesión.',
  'settings.title': 'Ajustes',
  'settings.language': 'Idioma',
  'settings.languageHelp': 'El idioma de la interfaz del Workspace.',
  'settings.saveFailed': 'No se pudo guardar el idioma.',
} as const;

export type MessageKey = keyof typeof es;
export type Dictionary = Readonly<Record<MessageKey, string>>;

export const en: Dictionary = {
  'window.minimize': 'Minimize',
  'window.maximize': 'Maximize',
  'window.restore': 'Restore',
  'window.close': 'Close',
  'workspace.comingSoon': 'Coming soon',
  'workspace.comingSoonDetail': 'This screen will arrive in a future version.',
  'rail.label': 'Primary',
  'rail.chat': 'Chat',
  'rail.projects': 'Projects',
  'rail.history': 'History',
  'rail.settings': 'Settings',
  'projects.title': 'Projects',
  'projects.collapse': 'Collapse projects',
  'projects.expand': 'Expand projects',
  'projects.placeholder': 'The project list is coming soon.',
  'projects.content': 'Project content',
  'projects.contentPlaceholder': "The project's sessions, terminals and files are coming soon.",
  'projects.showContent': 'Show project content',
  'projects.hideContent': 'Hide project content',
  'projects.chatPlaceholder': 'The session will open here.',
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageHelp': 'The language of the Workspace interface.',
  'settings.saveFailed': 'The language could not be saved.',
};

export const dictionaries: Readonly<Record<Language, Dictionary>> = { es, en };
