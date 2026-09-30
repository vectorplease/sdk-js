import type { components } from './generated/schema';

type Schemas = components['schemas'];

/** A finished conversion. `status: "failed"` means it missed a quality check; the SVG is still there. */
export type Conversion = Schemas['Conversion'];
/** A conversion that is still running. */
export type PendingConversion = Schemas['PendingConversion'];
export type ConversionParams = Schemas['ConversionParams'];
export type ConversionMetrics = Schemas['ConversionMetrics'];
export type FailureCode = Schemas['FailureCode'];
export type Preset = Schemas['PresetList']['presets'][number];
export type ErrorCode = Schemas['ErrorResponse']['error']['code'];
