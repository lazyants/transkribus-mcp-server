import { describe, it, expect } from 'vitest';
import { buildPylaiaTrainBody } from '../tools/pylaia.js';

type ParameterMap = { entry: Array<{ key: string; value: string }> };

function findEntry(pm: unknown, key: string): string | undefined {
  return (pm as ParameterMap).entry.find(e => e.key === key)?.value;
}

describe('buildPylaiaTrainBody', () => {
  describe('default mode (noTrainingDefaults unset)', () => {
    it('applies all three UI default blocks', () => {
      const body = buildPylaiaTrainBody({});
      expect(body.textFeatsCfg).toMatchObject({ deslope: true, deslant: true, normheight: 64, padding: 10 });
      expect(findEntry(body.createModelPars, '--use_masked_conv')).toBe('True');
      expect(findEntry(body.trainCtcPars, '--max_epochs')).toBe('100');
      expect(findEntry(body.trainCtcPars, '--use_baidu_ctc')).toBe('True');
      expect(findEntry(body.trainCtcPars, '--use_distortions')).toBe('True');
    });

    it('merges textFeatsCfg overrides with defaults', () => {
      const body = buildPylaiaTrainBody({ textFeatsCfg: { normheight: 128 } });
      expect(body.textFeatsCfg).toMatchObject({ normheight: 128, deslope: true });
    });

    it('merges createModelPars overrides with defaults', () => {
      const body = buildPylaiaTrainBody({ createModelPars: { '--rnn_units': '512' } });
      expect(findEntry(body.createModelPars, '--rnn_units')).toBe('512');
      expect(findEntry(body.createModelPars, '--use_masked_conv')).toBe('True');
    });

    it('shortcut max_epochs overrides default', () => {
      const body = buildPylaiaTrainBody({ max_epochs: 50 });
      expect(findEntry(body.trainCtcPars, '--max_epochs')).toBe('50');
    });

    it('shortcut overrides win over trainCtcPars override (shortcut applied last)', () => {
      const body = buildPylaiaTrainBody({
        trainCtcPars: { '--max_epochs': '999' },
        max_epochs: 7,
      });
      expect(findEntry(body.trainCtcPars, '--max_epochs')).toBe('7');
    });
  });

  describe('noTrainingDefaults=true', () => {
    it('omits all training config when no overrides given', () => {
      const body = buildPylaiaTrainBody({ noTrainingDefaults: true });
      expect(body.textFeatsCfg).toBeUndefined();
      expect(body.createModelPars).toBeUndefined();
      expect(body.trainCtcPars).toBeUndefined();
    });

    it('passes through explicit textFeatsCfg without merging defaults', () => {
      const body = buildPylaiaTrainBody({
        noTrainingDefaults: true,
        textFeatsCfg: { normheight: 32 },
      });
      expect(body.textFeatsCfg).toEqual({ normheight: 32 });
    });

    it('passes through explicit trainCtcPars without merging defaults', () => {
      const body = buildPylaiaTrainBody({
        noTrainingDefaults: true,
        trainCtcPars: { '--foo': 'bar' },
      });
      expect(body.trainCtcPars).toEqual({ entry: [{ key: '--foo', value: 'bar' }] });
    });

    // Regression: bot review caught silent shortcut drop when trainCtcPars unset.
    it('honors shortcut max_epochs even with no trainCtcPars override', () => {
      const body = buildPylaiaTrainBody({ noTrainingDefaults: true, max_epochs: 10 });
      expect(body.trainCtcPars).toEqual({ entry: [{ key: '--max_epochs', value: '10' }] });
    });

    it('combines trainCtcPars override with shortcut overrides', () => {
      const body = buildPylaiaTrainBody({
        noTrainingDefaults: true,
        trainCtcPars: { '--foo': 'bar' },
        max_epochs: 7,
        learning_rate: 0.001,
      });
      const entry = (body.trainCtcPars as ParameterMap).entry;
      expect(entry).toContainEqual({ key: '--foo', value: 'bar' });
      expect(entry).toContainEqual({ key: '--max_epochs', value: '7' });
      expect(entry).toContainEqual({ key: '--learning_rate', value: '0.001' });
    });

    it('honors all four shortcut fields when used standalone', () => {
      const body = buildPylaiaTrainBody({
        noTrainingDefaults: true,
        max_epochs: 50,
        max_nondecreasing_epochs: 5,
        learning_rate: 0.0003,
        batch_size: 16,
      });
      const entry = (body.trainCtcPars as ParameterMap).entry;
      expect(entry).toContainEqual({ key: '--max_epochs', value: '50' });
      expect(entry).toContainEqual({ key: '--max_nondecreasing_epochs', value: '5' });
      expect(entry).toContainEqual({ key: '--learning_rate', value: '0.0003' });
      expect(entry).toContainEqual({ key: '--batch_size', value: '16' });
    });
  });

  describe('JAXB ParameterMap shape', () => {
    it('emits {entry:[{key,value}]}, never wrapped in {params:...}', () => {
      const body = buildPylaiaTrainBody({});
      expect(body.createModelPars).toHaveProperty('entry');
      expect(body.createModelPars).not.toHaveProperty('params');
      expect(Array.isArray((body.createModelPars as ParameterMap).entry)).toBe(true);
    });
  });

  describe('trainList / testList grouping', () => {
    it('groups trainList pages by docId into nested pageList shape', () => {
      const body = buildPylaiaTrainBody({
        noTrainingDefaults: true,
        trainList: [
          { docId: 1, pageId: 10 },
          { docId: 1, pageId: 11 },
          { docId: 2, pageId: 20 },
        ],
      });
      expect(body.trainList).toEqual({
        train: [
          { docId: 1, pageList: { pages: [{ pageId: 10 }, { pageId: 11 }] } },
          { docId: 2, pageList: { pages: [{ pageId: 20 }] } },
        ],
      });
    });

    it('wraps testList in {test:[...]} not {train:[...]}', () => {
      const body = buildPylaiaTrainBody({
        noTrainingDefaults: true,
        testList: [{ docId: 5, pageId: 100 }],
      });
      expect(body.testList).toEqual({
        test: [{ docId: 5, pageList: { pages: [{ pageId: 100 }] } }],
      });
    });

    it('omits trainList when not provided', () => {
      const body = buildPylaiaTrainBody({ noTrainingDefaults: true });
      expect(body.trainList).toBeUndefined();
    });

    it('omits trainList when explicitly empty array', () => {
      const body = buildPylaiaTrainBody({ noTrainingDefaults: true, trainList: [] });
      expect(body.trainList).toBeUndefined();
    });

    it('omits testList when explicitly empty array', () => {
      const body = buildPylaiaTrainBody({ noTrainingDefaults: true, testList: [] });
      expect(body.testList).toBeUndefined();
    });
  });

  describe('passthrough body fields', () => {
    it('forwards unknown fields untouched', () => {
      const body = buildPylaiaTrainBody({
        noTrainingDefaults: true,
        modelName: 'test',
        baseModelId: 42,
        language: 'rus',
      });
      expect(body.modelName).toBe('test');
      expect(body.baseModelId).toBe(42);
      expect(body.language).toBe('rus');
    });
  });
});
