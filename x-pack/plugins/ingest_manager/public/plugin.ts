/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import {
  AppMountParameters,
  CoreSetup,
  Plugin,
  PluginInitializerContext,
  CoreStart,
} from 'src/core/public';
import { i18n } from '@kbn/i18n';
import { DEFAULT_APP_CATEGORIES } from '../../../../src/core/public';
import { DataPublicPluginSetup, DataPublicPluginStart } from '../../../../src/plugins/data/public';
import {
  HomePublicPluginSetup,
  FeatureCatalogueCategory,
} from '../../../../src/plugins/home/public';
import { LicensingPluginSetup } from '../../licensing/public';
import { PLUGIN_ID, CheckPermissionsResponse, PostIngestSetupResponse } from '../common';
import { BASE_PATH } from './constants';

import { IngestManagerConfigType } from '../common/types';
import { setupRouteService, appRoutesService } from '../common';
import { setHttpClient } from './applications/ingest_manager/hooks';
import {
  TutorialDirectoryNotice,
  TutorialDirectoryHeaderLink,
  TutorialModuleNotice,
} from './applications/ingest_manager/components/home_integration';
import { registerPackageConfigComponent } from './applications/ingest_manager/sections/agent_config/create_package_config_page/components/custom_package_config';

export { IngestManagerConfigType } from '../common/types';

// We need to provide an object instead of void so that dependent plugins know when Ingest Manager
// is disabled.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IngestManagerSetup {}

/**
 * Describes public IngestManager plugin contract returned at the `start` stage.
 */
export interface IngestManagerStart {
  registerPackageConfigComponent: typeof registerPackageConfigComponent;
  success: Promise<true>;
}

export interface IngestManagerSetupDeps {
  licensing: LicensingPluginSetup;
  data: DataPublicPluginSetup;
  home?: HomePublicPluginSetup;
}

export interface IngestManagerStartDeps {
  data: DataPublicPluginStart;
}

export class IngestManagerPlugin
  implements
    Plugin<IngestManagerSetup, IngestManagerStart, IngestManagerSetupDeps, IngestManagerStartDeps> {
  private config: IngestManagerConfigType;

  constructor(private readonly initializerContext: PluginInitializerContext) {
    this.config = this.initializerContext.config.get<IngestManagerConfigType>();
  }

  public setup(core: CoreSetup, deps: IngestManagerSetupDeps) {
    const config = this.config;

    // Set up http client
    setHttpClient(core.http);

    // Register main Ingest Manager app
    core.application.register({
      id: PLUGIN_ID,
      category: DEFAULT_APP_CATEGORIES.management,
      title: i18n.translate('xpack.ingestManager.appTitle', { defaultMessage: 'Ingest Manager' }),
      euiIconType: 'savedObjectsApp',
      async mount(params: AppMountParameters) {
        const [coreStart, startDeps] = (await core.getStartServices()) as [
          CoreStart,
          IngestManagerStartDeps,
          IngestManagerStart
        ];
        const { renderApp, teardownIngestManager } = await import('./applications/ingest_manager');
        const unmount = renderApp(coreStart, params, deps, startDeps, config);

        return () => {
          unmount();
          teardownIngestManager(coreStart);
        };
      },
    });

    // Register components for home/add data integration
    if (deps.home) {
      deps.home.tutorials.registerDirectoryNotice(PLUGIN_ID, TutorialDirectoryNotice);
      deps.home.tutorials.registerDirectoryHeaderLink(PLUGIN_ID, TutorialDirectoryHeaderLink);
      deps.home.tutorials.registerModuleNotice(PLUGIN_ID, TutorialModuleNotice);

      deps.home.featureCatalogue.register({
        id: 'ingestManager',
        title: i18n.translate('xpack.ingestManager.featureCatalogueTitle', {
          defaultMessage: 'Manage ingest',
        }),
        description: i18n.translate('xpack.ingestManager.featureCatalogueTitle', {
          defaultMessage: 'Management for Elastic Agents and integrations.',
        }),
        icon: 'logstashInput',
        showOnHomePage: true,
        path: BASE_PATH,
        category: FeatureCatalogueCategory.ADMIN, // TODO: is the correct category for this plugin?
      });
    }

    return {};
  }

  public async start(core: CoreStart): Promise<IngestManagerStart> {
    let successPromise: IngestManagerStart['success'];
    try {
      const permissionsResponse = await core.http.get<CheckPermissionsResponse>(
        appRoutesService.getCheckPermissionsPath()
      );

      if (permissionsResponse?.success) {
        successPromise = core.http
          .post<PostIngestSetupResponse>(setupRouteService.getSetupPath())
          .then(({ isInitialized }) =>
            isInitialized ? Promise.resolve(true) : Promise.reject(new Error('Unknown setup error'))
          );
      } else {
        throw new Error(permissionsResponse?.error || 'Unknown permissions error');
      }
    } catch (error) {
      successPromise = Promise.reject(error);
    }

    return {
      success: successPromise,
      registerPackageConfigComponent,
    };
  }

  public stop() {}
}
