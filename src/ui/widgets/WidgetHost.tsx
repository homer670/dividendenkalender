// Renders a widget with error isolation

import React from 'react';

import { DashboardWidget } from '../../core/model';
import { T } from '../components/basic';
import { Config, DashboardEnv } from './env';
import { WidgetCard } from './frame';
import { widgetSpec } from './registry';

class Boundary extends React.Component<{ label: string; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <WidgetCard title={this.props.label}>
          <T variant="caption" secondary>
            Fehler: {this.state.error.message}
          </T>
        </WidgetCard>
      );
    return this.props.children;
  }
}

export function WidgetHost({ widget, env, update }: { widget: DashboardWidget; env: DashboardEnv; update: (patch: Config) => void }) {
  const spec = widgetSpec(widget.type);
  if (!spec)
    return (
      <WidgetCard title={widget.label}>
        <T variant="caption" secondary>
          Dieses Widget ({widget.type}) wird nicht unterstützt.
        </T>
      </WidgetCard>
    );
  return <Boundary label={widget.label}>{spec.render({ widget, env, update })}</Boundary>;
}
