import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PropertyPanel } from '../PropertyPanel';
import { createCampusFairScene } from '../../scenarios/campusFair';
import { validateScene } from '../../domain/validation';

it('首次打开且未选中展位时正常渲染，不进入状态更新循环', () => {
  const scene = createCampusFairScene();
  const html = renderToString(createElement(PropertyPanel, {
    scene,
    selectedBooth: null,
    validation: validateScene(scene),
    onUpdateService: () => {},
    onUpdateQueueLength: () => {},
    onSelectBooth: () => {},
    metrics: null,
    runState: 'idle',
  }));

  expect(html).toContain('未选中对象');
  expect(html).toContain('地图统计');
});
