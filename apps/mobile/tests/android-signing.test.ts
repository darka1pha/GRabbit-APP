import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { addReleaseSigning } = require('../plugins/withAndroidFixes.js') as {
  addReleaseSigning: (gradle: string) => string;
};

/** The parts of Expo's app/build.gradle template that the plugin edits. */
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}`;

describe('Android release signing', () => {
  it('signs release builds with the upload key from the environment', () => {
    const out = addReleaseSigning(TEMPLATE);
    expect(out).toContain("storeFile file(grabbitStore)");
    expect(out).toContain(
      "signingConfig System.getenv('GRABBIT_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug"
    );
  });

  it('leaves debug builds on the debug key', () => {
    const out = addReleaseSigning(TEMPLATE);
    const debugType = out.slice(out.indexOf('buildTypes {'), out.indexOf('release {', out.indexOf('buildTypes {')));
    expect(debugType).toContain('signingConfig signingConfigs.debug');
  });

  it('is idempotent', () => {
    const once = addReleaseSigning(TEMPLATE);
    expect(addReleaseSigning(once)).toBe(once);
  });

  it('fails loudly when the template changes shape', () => {
    expect(() => addReleaseSigning('android {}')).toThrow(/signingConfigs/);
  });
});
